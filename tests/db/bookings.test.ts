import { beforeAll, describe, expect, it } from "vitest";
import { admin, asUser, createMatch, createUser, errorOf, localTime, mosul, notificationsOf, rpc } from "./helpers";

interface VenueFixture {
  owner: string;
  venue: string;
  field: string;
}

const ALL_DAYS_LATE = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opens: "08:00", closes: "02:00" }));

async function createVenue(opts: { verified?: boolean; autoConfirm?: boolean; buffer?: number; deadlineHours?: number } = {}): Promise<VenueFixture> {
  const owner = await createUser("Owner");
  const venue = await rpc<string>(owner, "create_venue", { p_name: `Pitch ${owner.slice(0, 5)}`, p_city_id: await mosul() });
  const field = await rpc<string>(owner, "upsert_venue_field", {
    p_venue_id: venue,
    p_field_id: null,
    p_name: "Field 1",
    p_surface: "artificial_turf",
    p_formats: "{5v5}",
    p_is_covered: false,
    p_has_lights: true,
    p_price_per_hour: 30_000,
  });
  await rpc(owner, "set_venue_opening_hours", { p_venue_id: venue, p_hours: ALL_DAYS_LATE });
  if (opts.verified !== false) {
    const moderator = await createUser("Mod", { admin: true });
    await rpc(moderator, "admin_set_venue_verification", { p_venue_id: venue, p_status: "verified" });
  }
  const [v] = await admin<Record<string, unknown>>("select * from public.venues where id = $1", [venue]);
  await rpc(owner, "update_venue", {
    p_venue_id: venue,
    p_name: v.name,
    p_city_id: v.city_id,
    p_booking_mode: "platform",
    p_auto_confirm: opts.autoConfirm ?? false,
    p_buffer_minutes: opts.buffer ?? 0,
    p_min_notice_minutes: 0,
    p_cancellation_deadline_hours: opts.deadlineHours ?? 12,
  });
  return { owner, venue, field };
}

const book = (user: string, field: string, start: string, minutes = 60) =>
  rpc<{ booking_id: string; status: string; price_total: number }>(user, "request_booking", {
    p_field_id: field,
    p_start_local: start,
    p_duration_minutes: minutes,
  });

describe("venue booking", () => {
  let fx: VenueFixture;
  beforeAll(async () => {
    fx = await createVenue();
  });

  it("quotes prices from the hourly rate and pricing rules using integer arithmetic", async () => {
    const q = await rpc<{ price_total: number; currency: string; available: boolean }>(null, "quote_booking", {
      p_field_id: fx.field,
      p_start_local: localTime(3, 18),
      p_duration_minutes: 90,
    });
    expect(q).toMatchObject({ price_total: 45_000, currency: "IQD", available: true });

    await rpc(fx.owner, "set_field_pricing_rules", {
      p_field_id: fx.field,
      p_rules: [{ weekdays: [0, 1, 2, 3, 4, 5, 6], start_time: "20:00", end_time: "00:00", price_per_hour: 40_000 }],
    });
    const peak = await rpc<{ price_total: number }>(null, "quote_booking", {
      p_field_id: fx.field,
      p_start_local: localTime(3, 21),
      p_duration_minutes: 60,
    });
    expect(peak.price_total).toBe(40_000);
  });

  it("rejects slots outside opening hours, including windows that cross midnight", async () => {
    expect(await errorOf(book(await createUser(), fx.field, localTime(4, 6), 60))).toBe("outside_opening_hours");
    // 01:00-02:00 belongs to the previous day's 08:00-02:00 window.
    const ok = await book(await createUser(), fx.field, localTime(4, 1), 60);
    expect(ok.status).toBe("requested");
    expect(await errorOf(book(await createUser(), fx.field, localTime(4, 1, 30), 60))).toBe("outside_opening_hours");
  });

  it("lets competing requests coexist, confirms one and auto-rejects the overlapping others", async () => {
    const [a, b] = [await createUser(), await createUser()];
    const ra = await book(a, fx.field, localTime(5, 19), 60);
    const rb = await book(b, fx.field, localTime(5, 19, 30), 60);
    expect([ra.status, rb.status]).toEqual(["requested", "requested"]);

    await rpc(fx.owner, "decide_booking", { p_booking_id: ra.booking_id, p_approve: true });
    const [other] = await admin<{ status: string; decision_note: string }>(
      "select status, decision_note from public.bookings where id = $1",
      [rb.booking_id],
    );
    expect(other).toEqual({ status: "rejected", decision_note: "slot_taken" });
    expect(await notificationsOf(a, "booking_confirmed")).toHaveLength(1);
    expect(await notificationsOf(b, "booking_rejected")).toHaveLength(1);
    expect(await errorOf(rpc(fx.owner, "decide_booking", { p_booking_id: rb.booking_id, p_approve: true }))).toBe(
      "booking_not_pending",
    );
    // A new request for the taken slot is refused up front.
    expect(await errorOf(book(await createUser(), fx.field, localTime(5, 19), 60))).toBe("slot_unavailable");
  });

  it("never confirms two overlapping bookings even when confirmed simultaneously", async () => {
    const requests = await Promise.all(
      Array.from({ length: 6 }, async (_, i) => book(await createUser(), fx.field, localTime(6, 17, i * 10), 60)),
    );
    const staff = await createUser("Staff");
    await rpc(fx.owner, "add_venue_staff", { p_venue_id: fx.venue, p_user_id: staff, p_role: "staff" });
    const results = await Promise.allSettled(
      requests.map((r, i) => rpc(i % 2 ? staff : fx.owner, "decide_booking", { p_booking_id: r.booking_id, p_approve: true })),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const r of results) {
      if (r.status === "rejected") expect(["slot_unavailable", "booking_not_pending"]).toContain((r.reason as Error).message);
    }
    const [{ count }] = await admin<{ count: string }>(
      "select count(*) from public.bookings where field_id = $1 and status = 'confirmed' and starts_at::date = ($2::timestamp at time zone 'Asia/Baghdad')::date",
      [fx.field, localTime(6, 17)],
    );
    expect(Number(count)).toBe(1);
  });

  it("handles simultaneous auto-confirmed requests and manual bookings safely", async () => {
    const auto = await createVenue({ autoConfirm: true });
    const users = await Promise.all(Array.from({ length: 8 }, () => createUser()));
    const results = await Promise.allSettled([
      ...users.map((u) => book(u, auto.field, localTime(3, 20), 60)),
      rpc(auto.owner, "create_manual_booking", {
        p_field_id: auto.field,
        p_start_local: localTime(3, 20, 30),
        p_duration_minutes: 60,
        p_kind: "manual",
        p_customer_name: "Walk-in",
      }),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled");
    expect(ok).toHaveLength(1);
    for (const r of results) {
      if (r.status === "rejected") expect((r.reason as Error).message).toBe("slot_unavailable");
    }
  });

  it("enforces the venue buffer between consecutive bookings", async () => {
    const buffered = await createVenue({ buffer: 15 });
    await rpc(buffered.owner, "create_manual_booking", {
      p_field_id: buffered.field,
      p_start_local: localTime(2, 18),
      p_duration_minutes: 60,
      p_kind: "manual",
    });
    expect(
      await errorOf(
        rpc(buffered.owner, "create_manual_booking", {
          p_field_id: buffered.field,
          p_start_local: localTime(2, 19),
          p_duration_minutes: 60,
          p_kind: "block",
        }),
      ),
    ).toBe("slot_unavailable");
    await rpc(buffered.owner, "create_manual_booking", {
      p_field_id: buffered.field,
      p_start_local: localTime(2, 19, 30),
      p_duration_minutes: 60,
      p_kind: "block",
    });
    const busy = await asUser<{ starts_at: Date }>(null, "select * from public.field_busy_intervals($1, $2::date)", [
      buffered.field,
      localTime(2).slice(0, 10),
    ]);
    expect(busy).toHaveLength(2);
  });

  it("does not take platform bookings for unverified or contact-only venues", async () => {
    const unverified = await createVenue({ verified: false });
    // update_venue was allowed to set platform mode, but requests are refused.
    expect(await errorOf(book(await createUser(), unverified.field, localTime(3, 18)))).toBe("venue_not_verified");
  });

  it("restricts booking decisions and visibility to the venue's own staff", async () => {
    const other = await createVenue();
    const customer = await createUser();
    const r = await book(customer, fx.field, localTime(7, 15), 60);
    expect(await errorOf(rpc(customer, "decide_booking", { p_booking_id: r.booking_id, p_approve: true }))).toBe("forbidden");
    expect(await errorOf(rpc(other.owner, "decide_booking", { p_booking_id: r.booking_id, p_approve: true }))).toBe("forbidden");
    expect(await asUser(other.owner, "select id from public.bookings where id = $1", [r.booking_id])).toEqual([]);
    expect(await asUser(await createUser(), "select id from public.bookings where id = $1", [r.booking_id])).toEqual([]);
    expect(await asUser(customer, "select id from public.bookings where id = $1", [r.booking_id])).toHaveLength(1);
    expect(await asUser(fx.owner, "select id from public.bookings where id = $1", [r.booking_id])).toHaveLength(1);
    // Another venue's owner cannot edit this venue either.
    expect(
      await errorOf(rpc(other.owner, "upsert_venue_field", {
        p_venue_id: fx.venue, p_field_id: null, p_name: "Hijack", p_surface: "indoor", p_formats: "{}",
        p_is_covered: true, p_has_lights: true, p_price_per_hour: 1,
      })),
    ).toBe("forbidden");
  });

  it("applies the customer cancellation deadline while staff can still cancel", async () => {
    const strict = await createVenue({ autoConfirm: true, deadlineHours: 48 });
    const customer = await createUser();
    const r = await book(customer, strict.field, localTime(1, 20), 60);
    expect(r.status).toBe("confirmed");
    expect(await errorOf(rpc(customer, "cancel_booking", { p_booking_id: r.booking_id }))).toBe("cancellation_deadline_passed");
    await rpc(strict.owner, "cancel_booking", { p_booking_id: r.booking_id, p_reason: "maintenance" });
    expect(await notificationsOf(customer, "booking_cancelled")).toHaveLength(1);
  });

  it("links a booking to a match and keeps the match booking status in sync", async () => {
    const organizer = await createUser("Org");
    const [{ start }] = [{ start: localTime(8, 18) }];
    const match = await createMatch(organizer, {
      days: 8,
      extra: { p_start_local: start, p_venue_id: fx.venue, p_field_id: fx.field, p_duration_minutes: 60 },
    });
    const res = await rpc<{ booking_id: string }>(organizer, "request_booking", {
      p_field_id: fx.field,
      p_start_local: start,
      p_duration_minutes: 60,
      p_match_id: match,
    });
    const status = async () =>
      (await admin<{ booking_status: string }>("select booking_status from public.matches where id = $1", [match]))[0].booking_status;
    expect(await status()).toBe("requested");
    await rpc(fx.owner, "decide_booking", { p_booking_id: res.booking_id, p_approve: true });
    expect(await status()).toBe("confirmed");
    await rpc(fx.owner, "cancel_booking", { p_booking_id: res.booking_id, p_reason: "closed" });
    expect(await status()).toBe("none");
    expect(await notificationsOf(organizer, "match_booking_lost")).toHaveLength(1);
  });
});
