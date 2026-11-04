import { randomUUID } from "node:crypto";
import { admin, createAuthUser, expect, localTime, mosul, rpc, signIn, test, type TestUser } from "./fixtures";

const DAYS = ["السبت", "الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة"];

test.describe("Journey F — venue onboarding, verification and booking", () => {
  test("an owner lists a venue, an admin verifies it, a customer books and the deposit confirms it", async ({ browser }) => {
    test.setTimeout(180_000);
    const owner = await createAuthUser("Owner");
    const moderator = await createAuthUser("Admin", { admin: true });
    const customer = await createAuthUser("Customer");
    const venueName = `E2E Arena ${randomUUID().slice(0, 6)}`;

    // Owner lists a venue with one court (its price and size filled in right away),
    // adds opening hours, and asks for verification.
    const ownerCtx = await browser.newContext();
    const ownerPage = await ownerCtx.newPage();
    await signIn(ownerPage, owner);
    await ownerPage.goto("/ar/manage/venues/new");
    await ownerPage.getByRole("textbox", { name: "اسم الملعب" }).fill(venueName);
    await ownerPage.getByRole("textbox", { name: "العنوان" }).fill("Al-Zuhur, near the roundabout");
    await ownerPage.getByRole("textbox", { name: "الهاتف" }).fill("0770 555 1234");
    await expect(ownerPage.getByRole("radio", { name: "ساحة واحدة" })).toBeChecked();
    await ownerPage.getByRole("textbox", { name: "السعر للساعة" }).fill("30000");
    await ownerPage.getByText("5v5", { exact: true }).click();
    await ownerPage.getByRole("button", { name: "إنشاء الملعب" }).click();
    await ownerPage.waitForURL(/\/ar\/manage\/venues\/[0-9a-f-]{36}/);
    const venueId = ownerPage.url().match(/venues\/([0-9a-f-]{36})/)![1];
    await expect(ownerPage.getByRole("heading", { name: venueName })).toBeVisible();

    // One court: edited in place, with no name to type and no "sub-pitch" anywhere.
    await ownerPage.getByRole("link", { name: "الساحة والسعر" }).click();
    await expect(ownerPage.getByRole("textbox", { name: "السعر للساعة" }).first()).toHaveValue("30000");
    await expect(ownerPage.getByRole("textbox", { name: "اسم الساحة" })).toHaveCount(0);
    await expect(ownerPage.getByText("فرعي")).toHaveCount(0);

    // Opening hours: Saturday's, given to every day at once.
    await expect(ownerPage.getByText("لا يستطيع الزبائن الحجز حتى تحدد ساعات العمل")).toBeVisible();
    await ownerPage.getByRole("link", { name: "ساعات العمل", exact: true }).click();
    await ownerPage.getByRole("checkbox", { name: "السبت" }).check();
    await ownerPage.getByLabel("وقت افتتاح السبت").fill("16:00");
    await ownerPage.getByLabel("وقت إغلاق السبت").fill("00:00");
    await ownerPage.getByRole("button", { name: "نفس ساعات السبت لكل الأيام" }).click();
    for (const day of DAYS) await expect(ownerPage.getByRole("checkbox", { name: day })).toBeChecked();
    await expect(ownerPage.getByLabel("وقت افتتاح الجمعة")).toHaveValue("16:00");
    await ownerPage.getByRole("button", { name: "حفظ الساعات" }).click();
    await expect(ownerPage.getByText("تم الحفظ.").or(ownerPage.getByRole("status")).first()).toBeVisible();
    // With hours set, the warning is gone.
    await ownerPage.reload();
    await expect(ownerPage.getByText("لا يستطيع الزبائن الحجز حتى تحدد ساعات العمل")).toHaveCount(0);

    // Not verified yet: the booking page refuses bookings, and there is no other way to book.
    const customerCtx = await browser.newContext();
    const customerPage = await customerCtx.newPage();
    await signIn(customerPage, customer);
    await customerPage.goto(`/ar/venues/${venueId}/book`);
    await expect(customerPage.getByText("الحجز غير متاح بعد في هذا الملعب")).toBeVisible();

    await ownerPage.getByRole("button", { name: "اطلب التحقق" }).click();
    await expect(ownerPage.getByText("التحقق قيد المراجعة")).toBeVisible();

    // An administrator verifies it.
    const adminCtx = await browser.newContext();
    const adminPage = await adminCtx.newPage();
    await signIn(adminPage, moderator);
    await adminPage.goto("/ar/admin/venues?status=pending");
    const card = adminPage.getByRole("listitem").filter({ hasText: venueName });
    await card.getByRole("combobox", { name: "حالة التحقق" }).selectOption("verified");
    await card.getByRole("button", { name: "تحديث" }).click();
    await expect(adminPage.getByRole("listitem").filter({ hasText: venueName })).toHaveCount(0);

    // Verified, the venue books in the site (there is no other method to choose);
    // customers can't book until it says where the deposit goes.
    await ownerPage.goto(`/ar/manage/venues/${venueId}?tab=profile`);
    await expect(ownerPage.getByText("التحقق قيد المراجعة")).toHaveCount(0);
    await expect(ownerPage.getByRole("combobox", { name: "طريقة الحجز" })).toHaveCount(0);
    await expect(ownerPage.getByText("الحجز يتم من الموقع فقط", { exact: false })).toBeVisible();
    await expect(ownerPage.getByText("لا يستطيع الزبائن الحجز حتى تضيف طريقة دفع العربون")).toBeVisible();
    await customerPage.goto(`/ar/venues/${venueId}/book`);
    await expect(customerPage.getByText("الحجز غير متاح بعد في هذا الملعب")).toBeVisible();
    await ownerPage.getByRole("textbox", { name: "طريقة دفع العربون" }).fill("ZainCash 0770 123 4567 (Ahmed)");
    await ownerPage.getByRole("button", { name: "حفظ طريقة الدفع" }).click();
    await expect(ownerPage.getByText("حُفظت طريقة الدفع.")).toBeVisible();

    // The venue page sends people to book in the site: its phone isn't shown.
    await customerPage.goto(`/ar/venues/${venueId}`);
    await expect(customerPage.getByRole("link", { name: "احجز موعداً" })).toBeVisible();
    await expect(customerPage.getByText("0770 555 1234")).toHaveCount(0);
    // Matches aren't created from a venue's page.
    await expect(customerPage.getByRole("link", { name: "أنشئ مباراة هنا" })).toHaveCount(0);
    // The hours: each day with the time it opens and the time it closes.
    const hours = customerPage.getByTestId("opening-hours");
    await expect(hours.getByRole("columnheader")).toHaveText(["اليوم", "يفتح", "يغلق"]);
    const saturday = hours.locator("tr", { hasText: "السبت" });
    await expect(saturday.getByRole("cell")).toHaveText(["٤:٠٠ م", "منتصف الليل"]);

    // One court: the booking page offers no court to choose, only the day's free times.
    const date = localTime(1).slice(0, 10);
    await customerPage.goto(`/ar/venues/${venueId}/book?date=${date}`);
    await expect(customerPage.getByRole("combobox", { name: "الساحة" })).toHaveCount(0);
    const free = customerPage.getByTestId("free-times");
    await free.getByRole("link", { name: "٨:٠٠ م", exact: true }).click();
    await expect(free.getByRole("link", { name: "٨:٠٠ م", exact: true })).toHaveAttribute("aria-current", "true");

    // The customer sees the deposit and where to send it, and books.
    await expect(customerPage.getByText("العربون لتثبيت الحجز")).toBeVisible();
    await expect(customerPage.getByText(/٥٬٠٠٠/).first()).toBeVisible();
    await expect(customerPage.getByText("ZainCash 0770 123 4567 (Ahmed)")).toBeVisible();
    await expect(customerPage.getByText("إن ألغيت الحجز لا يُرجَع العربون، وإن ألغاه الملعب يُرجعه لك.")).toBeVisible();
    await customerPage.getByRole("textbox", { name: "ملاحظة للملعب (اختياري)" }).fill("Team of ten");
    await customerPage.getByRole("button", { name: "احجز وأرسل العربون" }).click();

    // The time is held, and the customer is offered to add the booking to a calendar.
    await customerPage.waitForURL(/\/ar\/my\/bookings\?booked=[0-9a-f-]{36}/);
    const prompt = customerPage.getByTestId("booked-prompt");
    await expect(prompt.getByRole("heading", { name: "الوقت محجوز لك" })).toBeVisible();
    const ics = (await prompt.getByRole("link", { name: "تقويم الهاتف" }).getAttribute("href"))!;
    const file = await customerPage.request.get(ics);
    expect(file.headers()["content-type"]).toContain("text/calendar");
    const event = (await file.text()).replace(/\r\n /g, "");
    expect(event).toContain("BEGIN:VEVENT");
    expect(event).toContain(`SUMMARY:حجز ملعب: ${venueName}`);
    expect(event).toContain("TRIGGER:-PT120M");
    expect(await prompt.getByRole("link", { name: "تقويم Google" }).getAttribute("href")).toMatch(/^https:\/\/calendar\.google\.com\/calendar\/render\?action=TEMPLATE/);
    // Only the customer (and the venue) can read it.
    const stranger = await browser.newContext();
    expect((await stranger.request.get(new URL(ics, customerPage.url()).toString())).status()).toBe(404);
    await stranger.close();

    // The customer sends the deposit and says so.
    const held = customerPage.getByRole("listitem").filter({ hasText: venueName });
    await expect(customerPage.getByRole("heading", { name: "بانتظار عربونك" })).toBeVisible();
    await expect(held.getByText("ZainCash 0770 123 4567 (Ahmed)")).toBeVisible();
    await held.getByRole("textbox", { name: "بماذا يتعرّف الملعب على تحويلك؟" }).fill("from 0771 999 8888");
    await held.getByRole("button", { name: "أرسلت العربون" }).click();
    await expect(held.getByText("أخبرت الملعب أنك أرسلته («from 0771 999 8888»). يبقى الوقت محجوزاً لك حتى يثبّت الملعب الحجز.")).toBeVisible();

    // The owner sees the reported transfer and records the deposit.
    await ownerPage.goto(`/ar/manage/venues/${venueId}?tab=bookings`);
    const request = ownerPage.getByRole("listitem").filter({ hasText: "Team of ten" });
    await expect(request.getByText("يقول إنه أرسل العربون: «from 0771 999 8888»")).toBeVisible();
    await request.getByRole("button", { name: "استلمت العربون" }).click();
    await expect(ownerPage.getByText("لا توجد طلبات معلقة.")).toBeVisible();

    await customerPage.reload();
    const confirmed = customerPage.getByRole("listitem").filter({ hasText: venueName });
    await expect(confirmed.getByText("مؤكد", { exact: true })).toBeVisible();
    await expect(confirmed.getByText("استُلم العربون")).toBeVisible();
    await customerPage.goto("/ar/notifications");
    await expect(customerPage.getByText(new RegExp(`تم تأكيد حجزك في ${venueName}`)).first()).toBeVisible();

    await Promise.all([ownerCtx.close(), customerCtx.close(), adminCtx.close()]);
  });
});

test.describe("Journey F2 — a venue with several courts", () => {
  test("the owner adds courts by name, and only then do customers choose one", async ({ browser }) => {
    const owner = await createAuthUser("Owner");
    const customer = await createAuthUser("Customer");
    const venueName = `E2E Courts ${randomUUID().slice(0, 6)}`;
    const ownerCtx = await browser.newContext();
    const ownerPage = await ownerCtx.newPage();
    await signIn(ownerPage, owner);
    await ownerPage.goto("/ar/manage/venues/new");
    await ownerPage.waitForLoadState("networkidle");
    await ownerPage.getByRole("textbox", { name: "اسم الملعب" }).fill(venueName);
    await ownerPage.getByText("أكثر من ساحة", { exact: true }).click();
    // Several courts: no price here, they're added next, each with its name.
    await expect(ownerPage.getByRole("textbox", { name: "السعر للساعة" })).toHaveCount(0);
    await ownerPage.getByRole("button", { name: "إنشاء الملعب" }).click();
    await ownerPage.waitForURL(/\/ar\/manage\/venues\/[0-9a-f-]{36}\?tab=fields/);
    const venueId = ownerPage.url().match(/venues\/([0-9a-f-]{36})/)![1];
    await ownerPage.getByRole("textbox", { name: "اسم الساحة" }).fill("Court A");
    await ownerPage.getByRole("textbox", { name: "السعر للساعة" }).fill("20000");
    await ownerPage.getByText("5v5", { exact: true }).click();
    await ownerPage.getByRole("button", { name: "أضف ساحة" }).click();
    // With one court so far, it's edited in place; the second comes from «عندي أكثر من ساحة».
    await ownerPage.getByText("عندي أكثر من ساحة").click();
    const more = ownerPage.locator("details").filter({ hasText: "عندي أكثر من ساحة" });
    await more.getByRole("textbox", { name: "اسم الساحة" }).fill("Court B");
    await more.getByRole("textbox", { name: "السعر للساعة" }).fill("40000");
    await more.getByText("7v7", { exact: true }).click();
    await more.getByRole("button", { name: "أضف ساحة" }).click();
    await expect(ownerPage.getByRole("heading", { name: "Court B" })).toBeVisible();
    await expect(ownerPage.getByRole("link", { name: "الساحات والأسعار" })).toBeVisible();

    // Make it bookable (verification is a moderator decision, outside this journey).
    await rpc(owner.id, "set_venue_opening_hours", { p_venue_id: venueId, p_hours: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opens: "08:00", closes: "02:00" })) });
    await admin("update public.venues set verification_status = 'verified' where id = $1", [venueId]);
    await rpc(owner.id, "set_venue_deposit_instructions", { p_venue_id: venueId, p_instructions: "Cash at the desk" });

    const customerCtx = await browser.newContext();
    const customerPage = await customerCtx.newPage();
    await signIn(customerPage, customer);
    await customerPage.goto(`/ar/venues/${venueId}`);
    await expect(customerPage.getByRole("heading", { name: "الساحات والأسعار" })).toBeVisible();
    await customerPage.goto(`/ar/venues/${venueId}/book`);
    const court = customerPage.getByRole("combobox", { name: "الساحة" });
    await expect(court.locator("option")).toHaveText(["Court A", "Court B"]);
    await Promise.all([ownerCtx.close(), customerCtx.close()]);
  });
});

test.describe("Journey H — the platform team handles a venue's bookings", () => {
  test("an admin sees every booking and confirms one from the venue's bookings, without its settings", async ({ browser }) => {
    const owner = await createAuthUser("Owner");
    const customer = await createAuthUser("Customer");
    const moderator = await createAuthUser("Admin", { admin: true });
    const { venue, field, name } = await bookableVenue(owner);
    const booked = await rpc<{ booking_id: string }>(customer.id, "request_booking", {
      p_field_id: field,
      p_start_local: localTime(2, 18),
      p_duration_minutes: 60,
    });
    await rpc(customer.id, "report_booking_deposit", { p_booking_id: booked.booking_id, p_reference: "from 0771 222 3333" });

    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await signIn(page, moderator);
    await page.goto("/ar/admin/bookings");
    const row = page.getByRole("row").filter({ hasText: name });
    await expect(row).toBeVisible();
    await row.getByRole("link", { name: "إدارة" }).click();
    await page.waitForURL(new RegExp(`/ar/manage/venues/${venue}`));
    await expect(page.getByText("تدير حجوزات هذا الملعب بنفس صلاحيات إدارته", { exact: false })).toBeVisible();
    // The bookings only: the venue's settings stay its own.
    await expect(page.getByRole("link", { name: /^الساح(ة|ات)/ })).toHaveCount(0);
    const request = page.getByRole("listitem").filter({ hasText: "from 0771 222 3333" });
    await request.getByRole("button", { name: "استلمت العربون" }).click();
    await expect(page.getByText("لا توجد طلبات معلقة.")).toBeVisible();
    const [b] = await admin<{ status: string }>("select status from public.bookings where id = $1", [booked.booking_id]);
    expect(b.status).toBe("confirmed");
    await ctx.close();
  });

  test("on a small phone the bookings table scrolls inside its box, never the page", async ({ browser }) => {
    const owner = await createAuthUser("Owner");
    const customer = await createAuthUser("Customer");
    const moderator = await createAuthUser("Admin", { admin: true });
    const { field, name } = await bookableVenue(owner);
    await rpc(customer.id, "request_booking", { p_field_id: field, p_start_local: localTime(2, 20), p_duration_minutes: 60 });

    const ctx = await browser.newContext({ viewport: { width: 320, height: 700 } });
    const page = await ctx.newPage();
    await signIn(page, moderator);
    await page.goto("/ar/admin/bookings");
    await expect(page.getByRole("row").filter({ hasText: name })).toBeVisible();
    // Wider than the screen, so it scrolls sideways within its own frame...
    expect(await page.locator("main table").evaluate((t) => t.scrollWidth > t.parentElement!.clientWidth)).toBe(true);
    // ...and nothing in it (not even the column label kept for screen readers) pushes the page wider.
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
    await ctx.close();
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

test.describe("Journey G2 — what stops a booking is said plainly", () => {
  test("a venue without opening hours, and a customer with too many requests waiting, are told why", async ({ browser }) => {
    test.setTimeout(120_000);
    const owner = await createAuthUser("Owner");
    const customer = await createAuthUser("Customer");

    // Verified and paid for, but no opening hours: no time can be booked, and both sides are told.
    const venue = await rpc<string>(owner.id, "create_venue", { p_name: `E2E No Hours ${randomUUID().slice(0, 6)}`, p_city_id: await mosul() });
    await rpc(owner.id, "upsert_venue_field", {
      p_venue_id: venue, p_field_id: null, p_name: "Field 1", p_surface: "artificial_turf", p_formats: "{5v5}",
      p_is_covered: false, p_has_lights: true, p_price_per_hour: 30_000,
    });
    await admin("update public.venues set verification_status = 'verified' where id = $1", [venue]);
    await rpc(owner.id, "set_venue_deposit_instructions", { p_venue_id: venue, p_instructions: "Cash at the desk" });
    const customerCtx = await browser.newContext();
    const customerPage = await customerCtx.newPage();
    await signIn(customerPage, customer);
    await customerPage.goto(`/ar/venues/${venue}/book`);
    await expect(customerPage.getByText("لم يحدد الملعب ساعات عمله بعد")).toBeVisible();
    const ownerCtx = await browser.newContext();
    const ownerPage = await ownerCtx.newPage();
    await signIn(ownerPage, owner);
    await ownerPage.goto(`/ar/manage/venues/${venue}`);
    await expect(ownerPage.getByText("لا يستطيع الزبائن الحجز حتى تحدد ساعات العمل")).toBeVisible();
    await ownerPage.getByRole("link", { name: "حدد ساعات العمل" }).click();
    await expect(ownerPage.getByTestId("hours-editor")).toBeVisible();

    // Five requests waiting for an answer (the most allowed): said before picking a time, and no button that would fail.
    const { venue: open } = await bookableVenue(owner);
    const [{ id: field }] = await admin<{ id: string }>("select id from public.venue_fields where venue_id = $1", [open]);
    for (const hour of [9, 10, 11, 12, 13]) {
      await rpc(customer.id, "request_booking", { p_field_id: field, p_start_local: localTime(3, hour), p_duration_minutes: 60 });
    }
    await customerPage.goto(`/ar/venues/${open}/book?date=${localTime(4).slice(0, 10)}`);
    await expect(customerPage.getByText(/^لديك .+ طلبات حجز لم تُحسم بعد، وهذا أقصى عدد$/).first()).toBeVisible();
    await customerPage.getByTestId("free-times").getByRole("link", { name: "٨:٠٠ م", exact: true }).click();
    await expect(customerPage.getByText("العربون لتثبيت الحجز")).toBeVisible();
    await expect(customerPage.getByRole("button", { name: "احجز وأرسل العربون" })).toHaveCount(0);
    await Promise.all([customerCtx.close(), ownerCtx.close()]);
  });
});

test.describe("Journey G — overlapping booking attempts", () => {
  test("a time held for a deposit can't be booked twice, and is released when the deposit never comes", async ({ browser }) => {
    test.setTimeout(120_000);
    const owner = await createAuthUser("Owner");
    const first = await createAuthUser("First");
    const second = await createAuthUser("Second");
    const { venue, name } = await bookableVenue(owner);
    const date = localTime(2).slice(0, 10);
    const book = (time: string) => `/ar/venues/${venue}/book?date=${date}&time=${time}&duration=60`;

    // The first customer books 19:00; the time is held for their deposit.
    const firstCtx = await browser.newContext();
    const firstPage = await firstCtx.newPage();
    await signIn(firstPage, first);
    await firstPage.goto(book("19:00"));
    await firstPage.getByRole("textbox", { name: "ملاحظة للملعب (اختياري)" }).fill("First request");
    await firstPage.getByRole("button", { name: "احجز وأرسل العربون" }).click();
    await firstPage.waitForURL(/\/ar\/my\/bookings/);

    // Back on the same time, the first customer is told it's their own booking.
    await firstPage.goto(book("19:00"));
    await expect(firstPage.getByText("لديك حجز في هذا الوقت على هذا الملعب.")).toBeVisible();

    // The overlapping 19:30 is taken for everyone else, who is told why and isn't offered it.
    const secondCtx = await browser.newContext();
    const secondPage = await secondCtx.newPage();
    await signIn(secondPage, second);
    await secondPage.goto(book("19:30"));
    await expect(secondPage.getByText("الساعة ٧:٣٠ م غير متاحة")).toBeVisible();
    await expect(secondPage.getByText(/^هذا الوقت محجوز مؤقتاً لزبون آخر حتى يرسل العربون، إلى .+ على الأكثر\./)).toBeVisible();
    await expect(secondPage.getByRole("button", { name: "احجز وأرسل العربون" })).toHaveCount(0);
    const free = secondPage.getByTestId("free-times");
    await expect(free.getByRole("link", { name: "٦:٠٠ م", exact: true })).toBeVisible();
    for (const taken of ["٦:٣٠ م", "٧:٠٠ م", "٧:٣٠ م"]) await expect(free.getByRole("link", { name: taken, exact: true })).toHaveCount(0);

    // The deposit never arrives: the owner says so and the time is free again.
    const ownerCtx = await browser.newContext();
    const ownerPage = await ownerCtx.newPage();
    await signIn(ownerPage, owner);
    await ownerPage.goto(`/ar/manage/venues/${venue}?tab=bookings`);
    await expect(ownerPage.getByText("طلبات معلقة (1)")).toBeVisible();
    await ownerPage.getByRole("listitem").filter({ hasText: "First request" }).getByRole("button", { name: "لم يصل" }).click();
    await ownerPage.getByRole("dialog", { name: "لم يصل العربون؟" }).getByRole("button", { name: "لم يصل" }).click();
    await expect(ownerPage.getByText("لا توجد طلبات معلقة.")).toBeVisible();

    await firstPage.goto("/ar/my/bookings");
    const row = firstPage.getByRole("listitem").filter({ hasText: name });
    await expect(row.getByText("مرفوض", { exact: true })).toBeVisible();
    await expect(row.getByText("رُفض: يقول الملعب إن العربون لم يصل.")).toBeVisible();

    await secondPage.goto(book("19:30"));
    await expect(secondPage.getByTestId("free-times").getByRole("link", { name: "٧:٣٠ م", exact: true })).toHaveAttribute("aria-current", "true");
    await secondPage.getByRole("button", { name: "احجز وأرسل العربون" }).click();
    await secondPage.waitForURL(/\/ar\/my\/bookings/);
    await expect(secondPage.getByRole("heading", { name: "بانتظار عربونك" })).toBeVisible();

    await Promise.all([firstCtx.close(), secondCtx.close(), ownerCtx.close()]);
  });
});
