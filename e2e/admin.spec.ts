import { randomUUID } from "node:crypto";
import { createAuthUser, createMatchFor, expect, rpc, signIn, test } from "./fixtures";

test.describe("Journey I — reporting and moderation", () => {
  test("a user reports a match, an administrator hides it and resolves the report", async ({ browser }) => {
    test.setTimeout(120_000);
    const organizer = await createAuthUser("Organizer");
    const reporter = await createAuthUser("Reporter");
    const moderator = await createAuthUser("Admin", { admin: true });
    const title = `Suspicious ${randomUUID().slice(0, 6)}`;
    const matchId = await createMatchFor(organizer, { p_title: title });
    const details = `Spam listing ${randomUUID().slice(0, 6)}`;

    const repCtx = await browser.newContext();
    const rep = await repCtx.newPage();
    await signIn(rep, reporter);
    await rep.goto(`/ar/matches/${matchId}`);
    await rep.getByRole("button", { name: "إبلاغ" }).click();
    const dialog = rep.getByRole("dialog", { name: "الإبلاغ عن مشكلة" });
    await dialog.getByRole("combobox", { name: "ما المشكلة؟" }).selectOption("spam");
    await dialog.getByRole("textbox", { name: "تفاصيل (اختياري)" }).fill(details);
    await dialog.getByRole("button", { name: "إرسال البلاغ" }).click();
    await expect(dialog.getByText("شكراً. سيراجع المشرفون بلاغك.")).toBeVisible();

    const adminCtx = await browser.newContext();
    const adm = await adminCtx.newPage();
    await signIn(adm, moderator);
    // Bookings belong to each venue: the admin area has no bookings list.
    await adm.goto("/ar/admin/bookings");
    await expect(adm.getByRole("heading", { name: "الصفحة غير موجودة" })).toBeVisible();
    await adm.goto("/ar/admin/reports");
    await expect(adm.getByRole("navigation").getByRole("link", { name: "الحجوزات" })).toHaveCount(0);
    const card = adm.getByRole("listitem").filter({ hasText: details });
    await expect(card).toBeVisible();
    await expect(card).toContainText(reporter.name);

    await card.getByRole("button", { name: "إخفاء المحتوى" }).click();
    const confirm = adm.getByRole("dialog", { name: "إخفاء المحتوى" });
    await confirm.getByRole("textbox").fill("Spam listing confirmed");
    await confirm.getByRole("button", { name: "إخفاء المحتوى" }).click();

    const card2 = adm.getByRole("listitem").filter({ hasText: details });
    await card2.getByRole("combobox", { name: "حالة البلاغ" }).selectOption("resolved");
    await card2.getByRole("textbox", { name: "ملاحظة المعالجة" }).fill("Hidden for spam");
    await card2.getByRole("button", { name: "تحديث" }).click();
    await expect(adm.getByRole("listitem").filter({ hasText: details })).toHaveCount(0);
    await adm.goto("/ar/admin/reports?status=resolved");
    await expect(adm.getByRole("listitem").filter({ hasText: details })).toBeVisible();

    // The match is no longer visible to other users; the action is in the audit log.
    await rep.goto(`/ar/matches/${matchId}`);
    await expect(rep.getByRole("heading", { name: "الصفحة غير موجودة" })).toBeVisible();
    await adm.goto("/ar/admin/audit");
    await expect(adm.getByText("Spam listing confirmed").first()).toBeVisible();

    await Promise.all([repCtx.close(), adminCtx.close()]);
  });

  test("a reported chat message is removed by a moderator", async ({ browser }) => {
    const sender = await createAuthUser("Sender");
    const recipient = await createAuthUser("Recipient");
    const moderator = await createAuthUser("Admin", { admin: true });
    const conversation = await rpc<string>(sender.id, "start_direct_conversation", { p_user_id: recipient.id });
    const text = `abusive ${randomUUID().slice(0, 6)}`;
    await rpc(sender.id, "send_message", { p_conversation_id: conversation, p_body: text });

    const recCtx = await browser.newContext();
    const rec = await recCtx.newPage();
    await signIn(rec, recipient);
    await rec.goto(`/ar/messages/${conversation}`);
    await rec.getByRole("listitem").filter({ hasText: text }).getByRole("button", { name: "إبلاغ" }).click();
    const dialog = rec.getByRole("dialog", { name: "الإبلاغ عن مشكلة" });
    await dialog.getByRole("combobox", { name: "ما المشكلة؟" }).selectOption("harassment");
    await dialog.getByRole("button", { name: "إرسال البلاغ" }).click();
    await expect(dialog.getByText("شكراً. سيراجع المشرفون بلاغك.")).toBeVisible();

    const admCtx = await browser.newContext();
    const adm = await admCtx.newPage();
    await signIn(adm, moderator);
    await adm.goto("/ar/admin/reports");
    const card = adm.getByRole("listitem").filter({ hasText: text });
    await card.getByRole("button", { name: "حذف الرسالة" }).click();
    const confirm = adm.getByRole("dialog", { name: "حذف الرسالة" });
    await confirm.getByRole("textbox").fill("Harassment");
    await confirm.getByRole("button", { name: "حذف الرسالة" }).click();
    await expect(confirm).toBeHidden();

    await expect(async () => {
      await rec.reload();
      await expect(rec.getByText("رسالة محذوفة").first()).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 15_000 });
    await expect(rec.getByText(text)).toHaveCount(0);
    await Promise.all([recCtx.close(), admCtx.close()]);
  });

  test("a regular user cannot reach the admin area", async ({ page }) => {
    const user = await createAuthUser("Regular");
    await signIn(page, user);
    for (const path of ["/ar/admin", "/ar/admin/users", "/ar/admin/reports"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/ar\/dashboard/);
    }
  });
});
