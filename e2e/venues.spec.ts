import { randomUUID } from "node:crypto";
import { admin, createAuthUser, expect, localTime, mosul, rpc, signIn, test, type TestUser } from "./fixtures";

const DAYS = ["Saturday", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

test.describe("Journey F — venue onboarding, verification and booking", () => {
  test("an owner lists a venue, an admin verifies it, a customer books and the deposit confirms it", async ({ browser }) => {
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

    // The owner switches the venue to in-app booking; customers can't book
    // until it says where the deposit goes.
    await ownerPage.goto(`/en/manage/venues/${venueId}?tab=profile`);
    await ownerPage.getByRole("combobox", { name: "Booking mode" }).selectOption("platform");
    await ownerPage.getByRole("button", { name: "Save venue" }).click();
    await expect(ownerPage.getByText("Verification pending")).toHaveCount(0);
    await expect(ownerPage.getByText("Customers can't book until you add your deposit payment details")).toBeVisible();
    await customerPage.goto(`/en/venues/${venueId}/book`);
    await expect(customerPage.getByText("This venue isn't taking bookings in the app")).toBeVisible();
    await ownerPage.getByRole("textbox", { name: "Deposit payment details" }).fill("ZainCash 0770 123 4567 (Ahmed)");
    await ownerPage.getByRole("button", { name: "Save payment details" }).click();
    await expect(ownerPage.getByText("Payment details saved.")).toBeVisible();

    // The customer sees the deposit and where to send it, and books.
    const date = localTime(1).slice(0, 10);
    await customerPage.goto(`/en/venues/${venueId}/book?date=${date}&time=20:00&duration=60`);
    await expect(customerPage.getByText("Deposit to confirm")).toBeVisible();
    await expect(customerPage.getByText(/5,000/).first()).toBeVisible();
    await expect(customerPage.getByText("ZainCash 0770 123 4567 (Ahmed)")).toBeVisible();
    await expect(customerPage.getByText("If you cancel, the deposit isn't refunded. If the venue cancels, it returns it.")).toBeVisible();
    await customerPage.getByRole("textbox", { name: "Note for the venue (optional)" }).fill("Team of ten");
    await customerPage.getByRole("button", { name: "Book and send the deposit" }).click();

    // The time is held; the customer sends the deposit and says so.
    await customerPage.waitForURL(/\/en\/my\/bookings/);
    const held = customerPage.getByRole("listitem").filter({ hasText: venueName });
    await expect(customerPage.getByRole("heading", { name: "Waiting for your deposit" })).toBeVisible();
    await expect(held.getByText("ZainCash 0770 123 4567 (Ahmed)")).toBeVisible();
    await held.getByRole("textbox", { name: "How can the venue recognise your transfer?" }).fill("from 0771 999 8888");
    await held.getByRole("button", { name: "I've sent the deposit" }).click();
    await expect(held.getByText("You told the venue it's sent (“from 0771 999 8888”). Your time stays held until they confirm.")).toBeVisible();

    // The owner sees the reported transfer and records the deposit.
    await ownerPage.goto(`/en/manage/venues/${venueId}?tab=bookings`);
    const request = ownerPage.getByRole("listitem").filter({ hasText: "Team of ten" });
    await expect(request.getByText("Says the deposit is sent: “from 0771 999 8888”")).toBeVisible();
    await request.getByRole("button", { name: "Deposit received" }).click();
    await expect(ownerPage.getByText("No pending requests.")).toBeVisible();

    await customerPage.reload();
    const confirmed = customerPage.getByRole("listitem").filter({ hasText: venueName });
    await expect(confirmed.getByText("Confirmed", { exact: true })).toBeVisible();
    await expect(confirmed.getByText("Deposit received")).toBeVisible();
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
  await rpc(owner.id, "set_venue_deposit_instructions", { p_venue_id: venue, p_instructions: "Cash at the desk" });
  return { venue, field, name: v.name };
}

test.describe("Journey G — overlapping booking attempts", () => {
  test("a time held for a deposit can't be booked twice, and is released when the deposit never comes", async ({ browser }) => {
    test.setTimeout(120_000);
    const owner = await createAuthUser("Owner");
    const first = await createAuthUser("First");
    const second = await createAuthUser("Second");
    const { venue, name } = await bookableVenue(owner);
    const date = localTime(2).slice(0, 10);
    const book = (time: string) => `/en/venues/${venue}/book?date=${date}&time=${time}&duration=60`;

    // The first customer books 19:00; the time is held for their deposit.
    const firstCtx = await browser.newContext();
    const firstPage = await firstCtx.newPage();
    await signIn(firstPage, first);
    await firstPage.goto(book("19:00"));
    await firstPage.getByRole("textbox", { name: "Note for the venue (optional)" }).fill("First request");
    await firstPage.getByRole("button", { name: "Book and send the deposit" }).click();
    await firstPage.waitForURL(/\/en\/my\/bookings/);

    // The overlapping 19:30 is already taken for everyone else.
    const secondCtx = await browser.newContext();
    const secondPage = await secondCtx.newPage();
    await signIn(secondPage, second);
    await secondPage.goto(book("19:30"));
    await expect(secondPage.getByText("That slot is already taken. Try another time or field.")).toBeVisible();
    await expect(secondPage.getByRole("button", { name: "Book and send the deposit" })).toHaveCount(0);

    // The deposit never arrives: the owner says so and the time is free again.
    const ownerCtx = await browser.newContext();
    const ownerPage = await ownerCtx.newPage();
    await signIn(ownerPage, owner);
    await ownerPage.goto(`/en/manage/venues/${venue}?tab=bookings`);
    await expect(ownerPage.getByText("Pending requests (1)")).toBeVisible();
    await ownerPage.getByRole("listitem").filter({ hasText: "First request" }).getByRole("button", { name: "Not received" }).click();
    await ownerPage.getByRole("dialog", { name: "The deposit hasn't arrived?" }).getByRole("button", { name: "Not received" }).click();
    await expect(ownerPage.getByText("No pending requests.")).toBeVisible();

    await firstPage.reload();
    const row = firstPage.getByRole("listitem").filter({ hasText: name });
    await expect(row.getByText("Declined", { exact: true })).toBeVisible();
    await expect(row.getByText("Declined: the venue says the deposit didn't arrive.")).toBeVisible();

    await secondPage.goto(book("19:30"));
    await secondPage.getByRole("button", { name: "Book and send the deposit" }).click();
    await secondPage.waitForURL(/\/en\/my\/bookings/);
    await expect(secondPage.getByRole("heading", { name: "Waiting for your deposit" })).toBeVisible();

    await Promise.all([firstCtx.close(), secondCtx.close(), ownerCtx.close()]);
  });
});
