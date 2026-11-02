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

    // Owner lists the venue, adds a field and opening hours, and asks for verification.
    const ownerCtx = await browser.newContext();
    const ownerPage = await ownerCtx.newPage();
    await signIn(ownerPage, owner);
    await ownerPage.goto("/ar/manage/venues/new");
    await ownerPage.getByRole("textbox", { name: "اسم الملعب" }).fill(venueName);
    await ownerPage.getByRole("textbox", { name: "العنوان" }).fill("Al-Zuhur, near the roundabout");
    await ownerPage.getByRole("button", { name: "إنشاء الملعب" }).click();
    await ownerPage.waitForURL(/\/ar\/manage\/venues\/[0-9a-f-]{36}/);
    const venueId = ownerPage.url().match(/venues\/([0-9a-f-]{36})/)![1];
    await expect(ownerPage.getByRole("heading", { name: venueName })).toBeVisible();

    await ownerPage.getByRole("link", { name: "الملاعب والتسعير" }).click();
    await ownerPage.getByRole("textbox", { name: "اسم الملعب الفرعي" }).fill("Pitch A");
    await ownerPage.getByRole("textbox", { name: "السعر للساعة" }).fill("30000");
    await ownerPage.getByText("5v5", { exact: true }).click();
    await ownerPage.getByRole("button", { name: "أضف ملعباً فرعياً" }).click();
    await expect(ownerPage.getByRole("heading", { name: "Pitch A" })).toBeVisible();

    await ownerPage.getByRole("link", { name: "ساعات العمل" }).click();
    for (const day of DAYS) await ownerPage.getByRole("checkbox", { name: day }).check();
    await ownerPage.getByRole("button", { name: "حفظ الساعات" }).click();
    await expect(ownerPage.getByText("تم الحفظ.").or(ownerPage.getByRole("status")).first()).toBeVisible();

    // Not verified yet: the booking page refuses in-app bookings.
    const customerCtx = await browser.newContext();
    const customerPage = await customerCtx.newPage();
    await signIn(customerPage, customer);
    await customerPage.goto(`/ar/venues/${venueId}/book`);
    await expect(customerPage.getByText("هذا الملعب لا يستقبل الحجز في التطبيق")).toBeVisible();

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

    // The owner switches the venue to in-app booking; customers can't book
    // until it says where the deposit goes.
    await ownerPage.goto(`/ar/manage/venues/${venueId}?tab=profile`);
    await ownerPage.getByRole("combobox", { name: "طريقة الحجز" }).selectOption("platform");
    await ownerPage.getByRole("button", { name: "حفظ الملعب" }).click();
    await expect(ownerPage.getByText("التحقق قيد المراجعة")).toHaveCount(0);
    await expect(ownerPage.getByText("لا يستطيع الزبائن الحجز حتى تضيف طريقة دفع العربون")).toBeVisible();
    await customerPage.goto(`/ar/venues/${venueId}/book`);
    await expect(customerPage.getByText("هذا الملعب لا يستقبل الحجز في التطبيق")).toBeVisible();
    await ownerPage.getByRole("textbox", { name: "طريقة دفع العربون" }).fill("ZainCash 0770 123 4567 (Ahmed)");
    await ownerPage.getByRole("button", { name: "حفظ طريقة الدفع" }).click();
    await expect(ownerPage.getByText("حُفظت طريقة الدفع.")).toBeVisible();

    // The customer sees the deposit and where to send it, and books.
    const date = localTime(1).slice(0, 10);
    await customerPage.goto(`/ar/venues/${venueId}/book?date=${date}&time=20:00&duration=60`);
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
    const book = (time: string) => `/ar/venues/${venue}/book?date=${date}&time=${time}&duration=60`;

    // The first customer books 19:00; the time is held for their deposit.
    const firstCtx = await browser.newContext();
    const firstPage = await firstCtx.newPage();
    await signIn(firstPage, first);
    await firstPage.goto(book("19:00"));
    await firstPage.getByRole("textbox", { name: "ملاحظة للملعب (اختياري)" }).fill("First request");
    await firstPage.getByRole("button", { name: "احجز وأرسل العربون" }).click();
    await firstPage.waitForURL(/\/ar\/my\/bookings/);

    // The overlapping 19:30 is already taken for everyone else.
    const secondCtx = await browser.newContext();
    const secondPage = await secondCtx.newPage();
    await signIn(secondPage, second);
    await secondPage.goto(book("19:30"));
    await expect(secondPage.getByText("هذا الموعد محجوز. جرّب وقتاً أو ملعباً آخر.")).toBeVisible();
    await expect(secondPage.getByRole("button", { name: "احجز وأرسل العربون" })).toHaveCount(0);

    // The deposit never arrives: the owner says so and the time is free again.
    const ownerCtx = await browser.newContext();
    const ownerPage = await ownerCtx.newPage();
    await signIn(ownerPage, owner);
    await ownerPage.goto(`/ar/manage/venues/${venue}?tab=bookings`);
    await expect(ownerPage.getByText("طلبات معلقة (1)")).toBeVisible();
    await ownerPage.getByRole("listitem").filter({ hasText: "First request" }).getByRole("button", { name: "لم يصل" }).click();
    await ownerPage.getByRole("dialog", { name: "لم يصل العربون؟" }).getByRole("button", { name: "لم يصل" }).click();
    await expect(ownerPage.getByText("لا توجد طلبات معلقة.")).toBeVisible();

    await firstPage.reload();
    const row = firstPage.getByRole("listitem").filter({ hasText: name });
    await expect(row.getByText("مرفوض", { exact: true })).toBeVisible();
    await expect(row.getByText("رُفض: يقول الملعب إن العربون لم يصل.")).toBeVisible();

    await secondPage.goto(book("19:30"));
    await secondPage.getByRole("button", { name: "احجز وأرسل العربون" }).click();
    await secondPage.waitForURL(/\/ar\/my\/bookings/);
    await expect(secondPage.getByRole("heading", { name: "بانتظار عربونك" })).toBeVisible();

    await Promise.all([firstCtx.close(), secondCtx.close(), ownerCtx.close()]);
  });
});
