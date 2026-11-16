import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { admin, asUser, createMatch, createUser, errorOf, localTime, mosul, notificationsOf, rpc } from "./helpers";

/**
 * Deleting a member completely (migration 0030): admins only, everything that
 * is the member's own goes, a venue's bookings stay without their name, and
 * nobody can delete themselves, an admin, or the owner of a venue.
 */

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opens: "08:00", closes: "02:00" }));

async function moderator(): Promise<string> {
  const id = await createUser("Mod");
  await admin("insert into public.user_roles (user_id, role) values ($1, 'moderator')", [id]);
  return id;
}

/** A verified venue taking platform bookings, owned by `owner`. */
async function venueOf(owner: string) {
  const venue = await rpc<string>(owner, "create_venue", { p_name: `Pitch ${owner.slice(0, 5)}`, p_city_id: await mosul() });
  const field = await rpc<string>(owner, "upsert_venue_field", {
    p_venue_id: venue, p_field_id: null, p_name: "Field 1", p_surface: "artificial_turf", p_formats: "{5v5}",
    p_is_covered: false, p_has_lights: true, p_price_per_hour: 0,
  });
  await rpc(owner, "set_venue_opening_hours", { p_venue_id: venue, p_hours: ALL_DAYS });
  await admin("update public.venues set verification_status = 'verified' where id = $1", [venue]);
  const [v] = await admin<{ name: string; city_id: string }>("select name, city_id from public.venues where id = $1", [venue]);
  await rpc(owner, "update_venue", { p_venue_id: venue, p_name: v.name, p_city_id: v.city_id, p_booking_mode: "platform", p_min_notice_minutes: 0 });
  return { venue, field, name: v.name };
}

const remove = (actor: string | null, target: string, reason: string | null = null) =>
  asUser<{ r: { deleted: boolean; files: Record<string, string[]> } }>(actor, "select public.admin_delete_user($1, $2) as r", [target, reason]).then((rows) => rows[0].r);

const preview = (actor: string, target: string) =>
  rpc<{ display_name: string; blockers: { self: boolean; admin: boolean; owns_venues: string[] }; matches: number; messages: number; bookings: number; upcoming_bookings: number }>(
    actor, "admin_user_deletion_preview", { p_user_id: target },
  );

const exists = async (sql: string, params: unknown[]) => (await admin(sql, params)).length > 0;

describe("Deleting a member completely", () => {
  it("is for admins only: moderators, players and visitors can't, nor can anyone preview it", async () => {
    const target = await createUser("Target");
    for (const actor of [await moderator(), await createUser("Player")]) {
      expect(await errorOf(remove(actor, target))).toMatch(/forbidden/);
      expect(await errorOf(preview(actor, target))).toMatch(/forbidden/);
    }
    expect(await errorOf(remove(null, target))).toMatch(/permission denied/);
    // Two-step accounts act as admins only after the second step.
    const boss = await createUser("Boss", { admin: true });
    await admin(
      "insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at) values ($1, $2, 'phone', 'totp', 'verified', now(), now())",
      [randomUUID(), boss],
    );
    expect(await errorOf(asUser({ id: boss, aal: "aal1" }, "select public.admin_delete_user($1)", [target]))).toMatch(/mfa_required/);
    expect(await exists("select 1 from auth.users where id = $1", [target])).toBe(true);
  });

  it("takes the account and everything that is the member's own; the venue keeps the booking, without the name", async () => {
    const boss = await createUser("Boss", { admin: true });
    const target = await createUser("Target");
    const friend = await createUser("Friend");
    const owner = await createUser("Owner");
    const { field, venue } = await venueOf(owner);

    // Their own things: a number, a picture, consent, a match they organise (with someone else in it), messages.
    await admin("insert into private.user_phones (user_id, phone) values ($1, $2)", [target, `9647${String(Date.now()).slice(-9)}`]);
    await admin("update public.profiles set avatar_path = $2 where id = $1", [target, `${target}/avatar.webp`]);
    await rpc(target, "wa_signup_consent", { p_user_id: target, p_promos: true }).catch(() => undefined);
    await admin("insert into public.whatsapp_consent (user_id, opted_in_at) values ($1, now()) on conflict (user_id) do nothing", [target]);
    const match = await createMatch(target);
    await rpc(friend, "join_match", { p_match_id: match });
    const conv = await rpc<string>(target, "start_direct_conversation", { p_user_id: friend });
    const mine = await rpc<number>(target, "send_message", { p_conversation_id: conv, p_body: "رسالتي" });
    const picture = `${conv}/${randomUUID()}.webp`;
    await admin("update public.messages set image_path = $2 where id = $1", [mine, picture]);
    const theirs = await rpc<number>(friend, "send_message", { p_conversation_id: conv, p_body: "رسالة صديقي" });
    // A booking still to come.
    const booked = await rpc<{ booking_id: string }>(target, "request_booking", { p_field_id: field, p_start_local: localTime(3, 18), p_duration_minutes: 60 });

    const before = await preview(boss, target);
    expect(before).toMatchObject({ display_name: expect.stringMatching(/^Target/), blockers: { self: false, admin: false, owns_venues: [] }, matches: 1, messages: 1, bookings: 1, upcoming_bookings: 1 });

    const res = await remove(boss, target, "حساب وهمي");
    expect(res.deleted).toBe(true);
    expect(res.files).toEqual({ avatars: [`${target}/avatar.webp`], "message-images": [picture], "message-voice": [] });

    // Gone: the account, the profile, the number, the consent, the match they organised (with its places), their message.
    for (const [sql, id] of [
      ["select 1 from auth.users where id = $1", target],
      ["select 1 from public.profiles where id = $1", target],
      ["select 1 from private.user_phones where user_id = $1", target],
      ["select 1 from public.whatsapp_consent where user_id = $1", target],
      ["select 1 from public.matches where id = $1", match],
      ["select 1 from public.match_participants where match_id = $1", match],
      ["select 1 from public.messages where id = $1", String(mine)],
    ] as const) {
      expect(await exists(sql, [id])).toBe(false);
    }
    // Stays: the friend's own message, and the venue's booking, cancelled, with no name.
    expect(await exists("select 1 from public.messages where id = $1", [theirs])).toBe(true);
    const [b] = await admin<{ kind: string; status: string; requested_by: string | null; customer_name: string | null; cancel_reason: string | null; cancelled_by: string }>(
      "select kind, status, requested_by, customer_name, cancel_reason, cancelled_by from public.bookings where id = $1",
      [booked.booking_id],
    );
    expect(b).toMatchObject({ kind: "manual", status: "cancelled", requested_by: null, customer_name: "عضو محذوف", cancel_reason: "حُذف حساب صاحب الحجز", cancelled_by: boss });
    expect((await notificationsOf(owner, "booking_cancelled")).map((n) => n.payload.venue_id)).toContain(venue);
    // Recorded: who, when, how much, and the reason; nothing personal.
    const [log] = await admin<{ actor_id: string; details: Record<string, unknown> }>(
      "select actor_id, details from public.audit_logs where action = 'user_deleted' and entity_id = $1",
      [target],
    );
    expect(log).toMatchObject({ actor_id: boss, details: { matches: 1, messages: 1, bookings: 1, upcoming_bookings: 1, reason: "حساب وهمي" } });
    expect(JSON.stringify(log.details)).not.toContain("Target");
    // Twice is nothing to delete.
    expect(await errorOf(remove(boss, target))).toMatch(/user_not_found/);
  });

  it("won't delete oneself, an admin, or a venue's owner, and the preview says why; a venue's manager can go", async () => {
    const boss = await createUser("Boss", { admin: true });
    expect(await errorOf(remove(boss, boss))).toMatch(/cannot_delete_self/);
    expect((await preview(boss, boss)).blockers.self).toBe(true);

    const otherAdmin = await createUser("Other boss", { admin: true });
    expect(await errorOf(remove(boss, otherAdmin))).toMatch(/cannot_delete_admin/);
    expect((await preview(boss, otherAdmin)).blockers.admin).toBe(true);

    const owner = await createUser("Owner");
    const { venue, name } = await venueOf(owner);
    expect((await preview(boss, owner)).blockers.owns_venues).toEqual([name]);
    expect(await errorOf(remove(boss, owner))).toMatch(/venue_owner/);
    expect(await exists("select 1 from auth.users where id = $1", [owner])).toBe(true);

    // A manager of the venue can go; the venue and its owner stay.
    const manager = await createUser("Manager");
    await admin("insert into public.venue_staff (venue_id, user_id, role) values ($1, $2, 'manager')", [venue, manager]);
    expect((await preview(boss, manager)).blockers.owns_venues).toEqual([]);
    expect((await remove(boss, manager)).deleted).toBe(true);
    expect(await exists("select 1 from public.venues where id = $1", [venue])).toBe(true);
    expect(await exists("select 1 from public.venue_staff where venue_id = $1 and user_id = $2", [venue, owner])).toBe(true);

    expect(await errorOf(remove(boss, randomUUID()))).toMatch(/user_not_found/);
  });
});
