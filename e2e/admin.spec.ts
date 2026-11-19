import { randomUUID } from "node:crypto";
import { admin, createAuthUser, createMatchFor, expect, PASSWORD, rpc, signIn, test } from "./fixtures";

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
    await adm.goto("/ar/admin/reports");
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

test.describe("Deleting a member for good", () => {
  test("an admin sees what goes, confirms with «حذف», and the member is gone; admins have no such button", async ({ page, browser }) => {
    const boss = await createAuthUser("Boss", { admin: true });
    const target = await createAuthUser(`Gone ${randomUUID().slice(0, 6)}`);
    const otherAdmin = await createAuthUser(`Second boss ${randomUUID().slice(0, 6)}`, { admin: true });
    await createMatchFor(target);
    await signIn(page, boss);

    await page.goto(`/ar/admin/users?q=${encodeURIComponent(target.name)}`);
    await page.getByRole("row").filter({ hasText: target.name }).getByRole("link", { name: "حذف نهائي" }).click();
    await page.waitForURL(new RegExp(`/ar/admin/users/${target.id}/delete`));
    await expect(page.getByRole("heading", { name: "حذف العضو نهائياً" })).toBeVisible();
    await expect(page.getByTestId("delete-goes")).toContainText("المباريات التي نظّمها: ١");

    // Anything but the word deletes nothing.
    const confirm = page.getByRole("textbox", { name: /للتأكيد اكتب/ });
    await confirm.fill("نعم");
    await page.getByRole("button", { name: "احذف نهائياً" }).click();
    await expect(page.getByText("اكتب كلمة «حذف» كما هي للتأكيد.")).toBeVisible();
    expect(await admin("select 1 from auth.users where id = $1", [target.id])).toHaveLength(1);

    await page.getByRole("textbox", { name: "السبب (اختياري، يُحفظ في سجل الإدارة)" }).fill("حساب تجريبي");
    await confirm.fill("حذف");
    await page.getByRole("button", { name: "احذف نهائياً" }).click();
    await page.waitForURL(/\/ar\/admin\/users\?deleted=1/);
    await expect(page.getByText("حُذف العضو نهائياً.")).toBeVisible();
    expect(await admin("select 1 from auth.users where id = $1", [target.id])).toHaveLength(0);
    const [log] = await admin<{ actor_id: string; details: { reason?: string } }>(
      "select actor_id, details from public.audit_logs where action = 'user_deleted' and entity_id = $1",
      [target.id],
    );
    expect(log).toMatchObject({ actor_id: boss.id, details: { reason: "حساب تجريبي" } });

    // An admin has no such button, and their page refuses: the role goes first.
    await page.goto(`/ar/admin/users?q=${encodeURIComponent(otherAdmin.name)}`);
    await expect(page.getByRole("row").filter({ hasText: otherAdmin.name }).getByRole("link", { name: "حذف نهائي" })).toHaveCount(0);
    await page.goto(`/ar/admin/users/${otherAdmin.id}/delete`);
    await expect(page.getByText("هذا العضو مدير.", { exact: false })).toBeVisible();
    await expect(page.getByRole("button", { name: "احذف نهائياً" })).toHaveCount(0);

    // The deleted member can't sign in any more.
    const context = await browser.newContext();
    const other = await context.newPage();
    await other.goto("/ar/sign-in?method=email");
    await other.getByRole("textbox", { name: "البريد الإلكتروني" }).fill(target.email);
    await other.getByRole("textbox", { name: "كلمة المرور" }).fill(PASSWORD);
    await other.getByRole("button", { name: "تسجيل الدخول" }).click();
    await expect(other.getByText("البريد الإلكتروني أو كلمة المرور غير صحيحة.")).toBeVisible();
    await context.close();
  });

  test("moderators can't reach the delete page", async ({ page }) => {
    const moderator = await createAuthUser("Mod");
    await admin("insert into public.user_roles (user_id, role) values ($1, 'moderator')", [moderator.id]);
    const target = await createAuthUser("Target");
    await signIn(page, moderator);
    await page.goto(`/ar/admin/users/${target.id}/delete`);
    await expect(page).not.toHaveURL(/\/delete/);
    expect(await admin("select 1 from auth.users where id = $1", [target.id])).toHaveLength(1);
  });
});
