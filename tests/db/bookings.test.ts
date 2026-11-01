import { beforeAll, describe, expect, it } from "vitest";
import { admin, asUser, createMatch, createUser, errorOf, localTime, mosul, notificationsOf, rpc } from "./helpers";

interface VenueFixture {
  owner: string;
  venue: string;
  field: string;
}

const ALL_DAYS_LATE = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opens: "08:00", closes: "02:00" }));
const PAY_TO = "ZainCash 0770 000 0000";

/**
 * A verified venue taking platform bookings. Its field costs 30,000 IQD an
 * hour unless `price` says otherwise; a free field takes no deposit, which
 * exercises the same path as deposits being switched off.
 */
async function createVenue(
  opts: { verified?: boolean; autoConfirm?: boolean; buffer?: number; deadlineHours?: number; price?: number; payTo?: string | null } = {},
): Promise<VenueFixture> {
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
    p_price_per_hour: opts.price ?? 30_000,
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
  const payTo = opts.payTo === undefined ? PAY_TO : opts.payTo;
  if (payTo) await rpc(owner, "set_venue_deposit_instructions", { p_venue_id: venue, p_instructions: payTo });
  return { owner, venue, field };
}

type Booked = { booking_id: string; status: string; price_total: number; deposit_amount: number | null; expires_at: string | null };

const book = (user: string, field: string, start: string, minutes = 60) =>
  rpc<Booked>(user, "request_booking", {
    p_field_id: field,
    p_start_local: start,
    p_duration_minutes: minutes,
  });

const bookingRow = async (id: string) =>
  (
    await admin<{ status: string; deposit_status: string | null; deposit_amount: string | null; deposit_reference: string | null; decision_note: string | null; deposit_received_by: string | null }>(
      "select status, deposit_status, deposit_amount, deposit_reference, decision_note, deposit_received_by from public.bookings where id = $1",
      [id],
    )
  )[0];

describe("venue booking", () => {
  let fx: VenueFixture;
  beforeAll(async () => {
    fx = await createVenue();
  });

  it("quotes prices from the hourly rate and pricing rules using integer arithmetic", async () => {
    const q = await rpc<{ price_total: number; currency: string; available: boolean; deposit_amount: number; deposit_hold_minutes: number }>(null, "quote_booking", {
      p_field_id: fx.field,
      p_start_local: localTime(3, 18),
      p_duration_minutes: 90,
    });
    expect(q).toMatchObject({ price_total: 45_000, currency: "IQD", available: true, deposit_amount: 5_000, deposit_hold_minutes: 60 });

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

  it("without a deposit, competing requests coexist; confirming one auto-rejects the overlapping others", async () => {
    const free = await createVenue({ price: 0 });
    const [a, b] = [await createUser(), await createUser()];
    const ra = await book(a, free.field, localTime(5, 19), 60);
    const rb = await book(b, free.field, localTime(5, 19, 30), 60);
    expect([ra.status, rb.status]).toEqual(["requested", "requested"]);
    expect(ra.deposit_amount).toBeNull();

    await rpc(free.owner, "decide_booking", { p_booking_id: ra.booking_id, p_approve: true });
    const other = await bookingRow(rb.booking_id);
    expect(other).toMatchObject({ status: "rejected", decision_note: "slot_taken" });
    expect(await notificationsOf(a, "booking_confirmed")).toHaveLength(1);
    expect(await notificationsOf(b, "booking_rejected")).toHaveLength(1);
    expect(await errorOf(rpc(free.owner, "decide_booking", { p_booking_id: rb.booking_id, p_approve: true }))).toBe(
      "booking_not_pending",
    );
    // A new request for the taken slot is refused up front.
    expect(await errorOf(book(await createUser(), free.field, localTime(5, 19), 60))).toBe("slot_unavailable");
  });

  it("never confirms two overlapping bookings even when confirmed simultaneously", async () => {
    const free = await createVenue({ price: 0 });
    const requests = await Promise.all(
      Array.from({ length: 6 }, async (_, i) => book(await createUser(), free.field, localTime(6, 17, i * 10), 60)),
    );
    const staff = await createUser("Staff");
    await rpc(free.owner, "add_venue_staff", { p_venue_id: free.venue, p_user_id: staff, p_role: "staff" });
    const results = await Promise.allSettled(
      requests.map((r, i) => rpc(i % 2 ? staff : free.owner, "decide_booking", { p_booking_id: r.booking_id, p_approve: true })),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const r of results) {
      if (r.status === "rejected") expect(["slot_unavailable", "booking_not_pending"]).toContain((r.reason as Error).message);
    }
    const [{ count }] = await admin<{ count: string }>(
      "select count(*) from public.bookings where field_id = $1 and status = 'confirmed' and starts_at::date = ($2::timestamp at time zone 'Asia/Baghdad')::date",
      [free.field, localTime(6, 17)],
    );
    expect(Number(count)).toBe(1);
  });

  it("handles simultaneous auto-confirmed requests and manual bookings safely", async () => {
    const auto = await createVenue({ autoConfirm: true, price: 0 });
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
    const strict = await createVenue({ autoConfirm: true, deadlineHours: 48, price: 0 });
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

describe("booking deposits", () => {
  let fx: VenueFixture;
  beforeAll(async () => {
    fx = await createVenue();
  });

  it("holds the slot for an hour while the 5,000 IQD deposit is pending", async () => {
    const customer = await createUser();
    const r = await book(customer, fx.field, localTime(3, 18), 90);
    expect(r).toMatchObject({ status: "requested", price_total: 45_000, deposit_amount: 5_000 });
    const [{ minutes }] = await admin<{ minutes: string }>(
      "select extract(epoch from (expires_at - now())) / 60 as minutes from public.bookings where id = $1",
      [r.booking_id],
    );
    expect(Number(minutes)).toBeGreaterThan(58);
    expect(Number(minutes)).toBeLessThanOrEqual(60);
    expect((await bookingRow(r.booking_id)).deposit_status).toBe("pending");
    // Nobody else can take the held time, and it shows as busy.
    expect(await errorOf(book(await createUser(), fx.field, localTime(3, 19), 60))).toBe("slot_unavailable");
    const busy = await asUser(null, "select * from public.field_busy_intervals($1, $2::date)", [fx.field, localTime(3).slice(0, 10)]);
    expect(busy).toHaveLength(1);
    expect(await notificationsOf(fx.owner, "booking_awaiting_deposit")).not.toHaveLength(0);
  });

  it("asks for no more than the booking costs, and nothing for a free field", async () => {
    const cheap = await createVenue({ price: 3_000 });
    expect((await book(await createUser(), cheap.field, localTime(3, 18), 60)).deposit_amount).toBe(3_000);
    const free = await createVenue({ price: 0, payTo: null });
    expect((await book(await createUser(), free.field, localTime(3, 18), 60)).deposit_amount).toBeNull();
  });

  it("keeps the deposit when the venue auto-confirms, and needs the venue's payment details", async () => {
    const auto = await createVenue({ autoConfirm: true });
    expect((await book(await createUser(), auto.field, localTime(3, 18), 60)).status).toBe("requested");
    const silent = await createVenue({ payTo: null });
    expect(await errorOf(book(await createUser(), silent.field, localTime(3, 18), 60))).toBe("venue_deposit_not_set");
  });

  it("lets the customer report the transfer, which keeps the hold until the venue checks", async () => {
    const customer = await createUser();
    const r = await book(customer, fx.field, localTime(4, 18), 60);
    expect(await errorOf(rpc(customer, "report_booking_deposit", { p_booking_id: r.booking_id, p_reference: "  " }))).toBe("invalid_reference");
    expect(await errorOf(rpc(await createUser(), "report_booking_deposit", { p_booking_id: r.booking_id, p_reference: "x" }))).toBe(
      "booking_not_found",
    );
    await rpc(customer, "report_booking_deposit", { p_booking_id: r.booking_id, p_reference: "from 0771 111 2222" });
    expect(await bookingRow(r.booking_id)).toMatchObject({ deposit_status: "reported", deposit_reference: "from 0771 111 2222" });
    const [{ held_until_kickoff }] = await admin<{ held_until_kickoff: boolean }>(
      "select expires_at = starts_at as held_until_kickoff from public.bookings where id = $1",
      [r.booking_id],
    );
    expect(held_until_kickoff).toBe(true);
    expect(await notificationsOf(fx.owner, "booking_deposit_reported")).not.toHaveLength(0);
    expect(await errorOf(rpc(customer, "report_booking_deposit", { p_booking_id: r.booking_id, p_reference: "again" }))).toBe(
      "deposit_not_pending",
    );
  });

  it("confirms the booking when venue staff record the deposit, and declines when it never came", async () => {
    const staff = await createUser("Desk");
    await rpc(fx.owner, "add_venue_staff", { p_venue_id: fx.venue, p_user_id: staff, p_role: "staff" });
    const [paid, unpaid] = [await createUser(), await createUser()];
    const a = await book(paid, fx.field, localTime(5, 18), 60);
    const b = await book(unpaid, fx.field, localTime(5, 20), 60);
    expect(await errorOf(rpc(paid, "decide_booking", { p_booking_id: a.booking_id, p_approve: true }))).toBe("forbidden");

    await rpc(staff, "decide_booking", { p_booking_id: a.booking_id, p_approve: true });
    expect(await bookingRow(a.booking_id)).toMatchObject({ status: "confirmed", deposit_status: "received", deposit_received_by: staff });
    expect(await notificationsOf(paid, "booking_confirmed")).toHaveLength(1);

    await rpc(fx.owner, "decide_booking", { p_booking_id: b.booking_id, p_approve: false });
    expect(await bookingRow(b.booking_id)).toMatchObject({ status: "rejected", decision_note: "deposit_not_received" });
    expect(await notificationsOf(unpaid, "booking_rejected")).toHaveLength(1);
    // The declined time is free again.
    await book(await createUser(), fx.field, localTime(5, 20), 60);
  });

  it("releases an unpaid hold once its hour is up, without waiting for the scheduled job", async () => {
    const [late, next] = [await createUser(), await createUser()];
    const r = await book(late, fx.field, localTime(6, 18), 60);
    await admin("update public.bookings set expires_at = now() - interval '1 minute' where id = $1", [r.booking_id]);
    await book(next, fx.field, localTime(6, 18), 60);
    expect((await bookingRow(r.booking_id)).status).toBe("expired");
    const notes = await notificationsOf(late, "booking_deposit_expired");
    expect(notes).toHaveLength(1);
    expect(notes[0].payload.refund).toBe(false);
    expect(await errorOf(rpc(late, "report_booking_deposit", { p_booking_id: r.booking_id, p_reference: "too late" }))).toBe(
      "deposit_window_closed",
    );
  });

  it("owes back a reported deposit the venue never checked before kickoff", async () => {
    const customer = await createUser();
    const r = await book(customer, fx.field, localTime(7, 18), 60);
    await rpc(customer, "report_booking_deposit", { p_booking_id: r.booking_id, p_reference: "sent" });
    await admin("update public.bookings set expires_at = now() - interval '1 minute' where id = $1", [r.booking_id]);
    await admin("select public.run_scheduled_jobs()");
    expect(await bookingRow(r.booking_id)).toMatchObject({ status: "expired", deposit_status: "refund_due" });
    expect(await notificationsOf(fx.owner, "booking_deposit_refund_due")).not.toHaveLength(0);
    const notes = await notificationsOf(customer, "booking_deposit_expired");
    expect(notes).toHaveLength(1);
    expect(notes[0].payload.refund).toBe(true);
    // The generic "expired" notice is not sent on top.
    expect(await notificationsOf(customer, "booking_expired")).toHaveLength(0);
  });

  it("keeps the deposit when the customer cancels, and owes it back when the venue cancels", async () => {
    const [quitter, dropped] = [await createUser(), await createUser()];
    const a = await book(quitter, fx.field, localTime(8, 18), 60);
    const b = await book(dropped, fx.field, localTime(8, 20), 60);
    for (const r of [a, b]) await rpc(fx.owner, "decide_booking", { p_booking_id: r.booking_id, p_approve: true });

    await rpc(quitter, "cancel_booking", { p_booking_id: a.booking_id });
    expect(await bookingRow(a.booking_id)).toMatchObject({ status: "cancelled", deposit_status: "forfeited" });
    expect(await errorOf(rpc(fx.owner, "mark_deposit_refunded", { p_booking_id: a.booking_id }))).toBe("deposit_not_refundable");

    await rpc(fx.owner, "cancel_booking", { p_booking_id: b.booking_id, p_reason: "pitch repairs" });
    expect(await bookingRow(b.booking_id)).toMatchObject({ status: "cancelled", deposit_status: "refund_due" });
    expect(await notificationsOf(dropped, "booking_cancelled_refund")).toHaveLength(1);
    expect(await errorOf(rpc(dropped, "mark_deposit_refunded", { p_booking_id: b.booking_id }))).toBe("forbidden");
    await rpc(fx.owner, "mark_deposit_refunded", { p_booking_id: b.booking_id });
    expect((await bookingRow(b.booking_id)).deposit_status).toBe("refunded");
    expect(await notificationsOf(dropped, "booking_deposit_refunded")).toHaveLength(1);
  });

  it("leaves exactly one hold when many people book the same slot at once", async () => {
    const rush = await createVenue();
    const users = await Promise.all(Array.from({ length: 10 }, () => createUser()));
    const results = await Promise.allSettled([
      ...users.map((u, i) => book(u, rush.field, localTime(3, 20, (i % 3) * 15), 60)),
      rpc(rush.owner, "create_manual_booking", {
        p_field_id: rush.field,
        p_start_local: localTime(3, 20, 30),
        p_duration_minutes: 60,
        p_kind: "manual",
      }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const r of results) {
      if (r.status === "rejected") expect((r.reason as Error).message).toBe("slot_unavailable");
    }
  });

  it("lets only owners and managers change where deposits are paid, and audits every change", async () => {
    const [desk, manager] = [await createUser("Desk"), await createUser("Manager")];
    await rpc(fx.owner, "add_venue_staff", { p_venue_id: fx.venue, p_user_id: desk, p_role: "staff" });
    await rpc(fx.owner, "add_venue_staff", { p_venue_id: fx.venue, p_user_id: manager, p_role: "manager" });
    expect(
      await errorOf(rpc(desk, "set_venue_deposit_instructions", { p_venue_id: fx.venue, p_instructions: "Pay me instead" })),
    ).toBe("forbidden");
    await rpc(manager, "set_venue_deposit_instructions", { p_venue_id: fx.venue, p_instructions: "AsiaHawala 0750 000 0000" });
    const [{ count }] = await admin<{ count: string }>(
      "select count(*) from public.audit_logs where action = 'venue.deposit_instructions_updated' and entity_id = $1",
      [fx.venue],
    );
    expect(Number(count)).toBeGreaterThanOrEqual(2);
  });
});
