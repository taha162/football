import { randomUUID } from "node:crypto";
import { admin, createAuthUser, expect, localTime, mosul, rpc, signIn, test, type TestUser } from "./fixtures";

const DAYS = ["Saturday", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

test.describe("Journey F — venue onboarding, verification and booking", () => {
  test("an owner lists a venue, an admin verifies it, a customer books and the owner confirms", async ({ browser }) => {
    test.setTimeout(180_000);
    const owner = await createAuthUser("Owner");
    const moderator = await createAuthUser("Admin", { admin: true });
    const customer = await createAuthUser("Customer");
    const venueName = `E2E Arena ${randomUUID().slice(0, 6)}`;

    // Owner lists the venue, adds a field and opening hours, and asks for verification.
    const ownerCtx = await browser.newContext();
    const ownerPage = await ownerCtx.newPage();
    await signIn(ownerPage, owner);
    await ownerPage.goto("/en/manage/venues/new");
    await ownerPage.getByRole("textbox", { name: "Venue name" }).fill(venueName);
    await ownerPage.getByRole("textbox", { name: "Address" }).fill("Al-Zuhur, near the roundabout");
    await ownerPage.getByRole("button", { name: "Create venue" }).click();
    await ownerPage.waitForURL(/\/en\/manage\/venues\/[0-9a-f-]{36}/);
    const venueId = ownerPage.url().match(/venues\/([0-9a-f-]{36})/)![1];
    await expect(ownerPage.getByRole("heading", { name: venueName })).toBeVisible();

    await ownerPage.getByRole("link", { name: "Fields & pricing" }).click();
    await ownerPage.getByRole("textbox", { name: "Field name" }).fill("Pitch A");
    await ownerPage.getByRole("textbox", { name: "Price per hour" }).fill("30000");
    await ownerPage.getByText("5v5", { exact: true }).click();
    await ownerPage.getByRole("button", { name: "Add field" }).click();
    await expect(ownerPage.getByRole("heading", { name: "Pitch A" })).toBeVisible();

    await ownerPage.getByRole("link", { name: "Opening hours" }).click();
    for (const day of DAYS) await ownerPage.getByRole("checkbox", { name: day }).check();
    await ownerPage.getByRole("button", { name: "Save hours" }).click();
    await expect(ownerPage.getByText("Saved.").or(ownerPage.getByRole("status")).first()).toBeVisible();

    // Not verified yet: the booking page refuses in-app bookings.
    const customerCtx = await browser.newContext();
    const customerPage = await customerCtx.newPage();
    await signIn(customerPage, customer);
    await customerPage.goto(`/en/venues/${venueId}/book`);
    await expect(customerPage.getByText("This venue isn't taking bookings in the app")).toBeVisible();

    await ownerPage.getByRole("button", { name: "Request verification" }).click();
    await expect(ownerPage.getByText("Verification pending")).toBeVisible();

    // An administrator verifies it.
    const adminCtx = await browser.newContext();
    const adminPage = await adminCtx.newPage();
    await signIn(adminPage, moderator);
    await adminPage.goto("/en/admin/venues?status=pending");
    const card = adminPage.getByRole("listitem").filter({ hasText: venueName });
    await card.getByRole("combobox", { name: "Verification status" }).selectOption("verified");
    await card.getByRole("button", { name: "Update" }).click();
    await expect(adminPage.getByRole("listitem").filter({ hasText: venueName })).toHaveCount(0);

    // The owner switches the venue to in-app booking requests.
    await ownerPage.goto(`/en/manage/venues/${venueId}?tab=profile`);
    await ownerPage.getByRole("combobox", { name: "Booking mode" }).selectOption("platform");
    await ownerPage.getByRole("button", { name: "Save venue" }).click();
    await expect(ownerPage.getByText("Verification pending")).toHaveCount(0);

    // The customer checks availability and sends a request.
    const date = localTime(1).slice(0, 10);
    await customerPage.goto(`/en/venues/${venueId}/book?date=${date}&time=20:00&duration=60`);
    await expect(customerPage.getByText("Pay the venue directly. No payment is taken in the app.")).toBeVisible();
    await customerPage.getByRole("textbox", { name: "Note for the venue (optional)" }).fill("Team of ten");
    await customerPage.getByRole("button", { name: "Send booking request" }).click();
    await expect(customerPage.getByText("Booking requested. The venue will confirm or decline.")).toBeVisible();
    await customerPage.goto("/en/my/bookings");
    const mine = customerPage.getByRole("listitem").filter({ hasText: venueName });
    await expect(mine.getByText("Waiting for venue")).toBeVisible();

    // The owner confirms it.
    await ownerPage.goto(`/en/manage/venues/${venueId}?tab=bookings`);
    const request = ownerPage.getByRole("listitem").filter({ hasText: "Team of ten" });
    await request.getByRole("button", { name: "Confirm" }).click();
    await expect(ownerPage.getByText("No pending requests.")).toBeVisible();

    await customerPage.reload();
    await expect(customerPage.getByRole("listitem").filter({ hasText: venueName }).getByText("Confirmed")).toBeVisible();
    await customerPage.goto("/en/notifications");
    await expect(customerPage.getByText(new RegExp(`confirmed.*${venueName}|${venueName}.*confirmed`, "i")).first()).toBeVisible();

    await Promise.all([ownerCtx.close(), customerCtx.close(), adminCtx.close()]);
  });
});

async function bookableVenue(owner: TestUser) {
  const venue = await rpc<string>(owner.id, "create_venue", { p_name: `E2E Pitch ${randomUUID().slice(0, 6)}`, p_city_id: await mosul() });
  const field = await rpc<string>(owner.id, "upsert_venue_field", {
    p_venue_id: venue,
    p_field_id: null,
    p_name: "Field 1",
    p_surface: "artificial_turf",
    p_formats: "{5v5}",
    p_is_covered: false,
    p_has_lights: true,
    p_price_per_hour: 30_000,
  });
  await rpc(owner.id, "set_venue_opening_hours", {
    p_venue_id: venue,
    p_hours: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opens: "08:00", closes: "02:00" })),
  });
  // Verification is a moderator decision; the journey under test is the booking conflict.
  await admin("update public.venues set verification_status = 'verified' where id = $1", [venue]);
  const [v] = await admin<{ name: string; city_id: string }>("select name, city_id from public.venues where id = $1", [venue]);
  await rpc(owner.id, "update_venue", { p_venue_id: venue, p_name: v.name, p_city_id: v.city_id, p_booking_mode: "platform", p_min_notice_minutes: 0 });
  return { venue, field, name: v.name };
}

test.describe("Journey G — overlapping booking requests", () => {
  test("only one of two overlapping requests can be confirmed and the slot then shows as taken", async ({ browser }) => {
    test.setTimeout(120_000);
    const owner = await createAuthUser("Owner");
    const first = await createAuthUser("First");
    const second = await createAuthUser("Second");
    const third = await createAuthUser("Third");
    const { venue, name } = await bookableVenue(owner);
    const date = localTime(2).slice(0, 10);

    for (const [user, time, note] of [
      [first, "19:00", "First request"],
      [second, "19:30", "Second request"],
    ] as const) {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await signIn(page, user);
      await page.goto(`/en/venues/${venue}/book?date=${date}&time=${time}&duration=60`);
      await page.getByRole("textbox", { name: "Note for the venue (optional)" }).fill(note);
      await page.getByRole("button", { name: "Send booking request" }).click();
      await expect(page.getByText("Booking requested. The venue will confirm or decline.")).toBeVisible();
      await ctx.close();
    }

    const ownerCtx = await browser.newContext();
    const ownerPage = await ownerCtx.newPage();
    await signIn(ownerPage, owner);
    await ownerPage.goto(`/en/manage/venues/${venue}?tab=bookings`);
    await expect(ownerPage.getByText("Pending requests (2)")).toBeVisible();
    await ownerPage.getByRole("listitem").filter({ hasText: "First request" }).getByRole("button", { name: "Confirm" }).click();
    // The overlapping request is declined automatically, in the same transaction.
    await expect(ownerPage.getByText("No pending requests.")).toBeVisible();

    const secondCtx = await browser.newContext();
    const secondPage = await secondCtx.newPage();
    await signIn(secondPage, second);
    await secondPage.goto("/en/my/bookings");
    const row = secondPage.getByRole("listitem").filter({ hasText: name });
    await expect(row.getByText("Declined", { exact: true })).toBeVisible();
    await expect(row.getByText("Declined automatically: the slot was confirmed for another booking.")).toBeVisible();

    // A third customer can no longer get the overlapping slot.
    const thirdCtx = await browser.newContext();
    const thirdPage = await thirdCtx.newPage();
    await signIn(thirdPage, third);
    await thirdPage.goto(`/en/venues/${venue}/book?date=${date}&time=19:30&duration=60`);
    await expect(thirdPage.getByText("That slot is already taken. Try another time or field.")).toBeVisible();
    await expect(thirdPage.getByRole("button", { name: "Send booking request" })).toHaveCount(0);
    await thirdPage.goto(`/en/venues/${venue}/book?date=${date}&time=20:00&duration=60`);
    await expect(thirdPage.getByRole("button", { name: "Send booking request" })).toBeVisible();

    await Promise.all([ownerCtx.close(), secondCtx.close(), thirdCtx.close()]);
  });
});
