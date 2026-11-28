import { admin, createAuthUser, expect, mosul, PASSWORD, rpc, signIn, test } from "./fixtures";

/** Members delete their own account (Settings → «حذف الحساب»; migration 0050), as the app stores require. */
test.describe("Deleting one's own account", () => {
  test("the word and the password are asked; then the account is gone and can't sign in", async ({ page }) => {
    const me = await createAuthUser("Leaving");
    await signIn(page, me);
    await page.goto("/ar/settings");
    const section = page.getByRole("region", { name: "حذف الحساب" });
    await expect(section.getByText("يُحذف حسابك نهائياً، ولا يمكن استرجاعه.")).toBeVisible();

    await section.getByRole("textbox", { name: "اكتب «حذف» للتأكيد" }).fill("نعم");
    await section.getByLabel("كلمة المرور الحالية").fill(PASSWORD);
    await section.getByRole("button", { name: "حذف حسابي نهائياً" }).click();
    await expect(section.getByText("اكتب كلمة «حذف» كما هي للتأكيد.")).toBeVisible();

    await section.getByRole("textbox", { name: "اكتب «حذف» للتأكيد" }).fill("حذف");
    await section.getByLabel("كلمة المرور الحالية").fill("not-my-password");
    await section.getByRole("button", { name: "حذف حسابي نهائياً" }).click();
    await expect(section.getByText("كلمة المرور غير صحيحة.")).toBeVisible();
    expect(await admin("select 1 from auth.users where id = $1", [me.id])).toHaveLength(1);

    await section.getByRole("textbox", { name: "سبب الحذف (اختياري)" }).fill("انتقلت إلى مدينة أخرى");
    await section.getByLabel("كلمة المرور الحالية").fill(PASSWORD);
    await section.getByRole("button", { name: "حذف حسابي نهائياً" }).click();
    await page.waitForURL(/\/ar\/sign-in\?account=deleted/);
    await expect(page.getByText("تم حذف حسابك. شكراً لأنك كنت معنا.")).toBeVisible();
    expect(await admin("select 1 from auth.users where id = $1", [me.id])).toHaveLength(0);

    // Signed out, and the old password opens nothing.
    await page.goto("/ar/settings");
    await page.waitForURL(/\/ar\/sign-in/);
    await page.goto("/ar/sign-in?method=email");
    await page.getByRole("textbox", { name: "البريد الإلكتروني" }).fill(me.email);
    await page.getByRole("textbox", { name: "كلمة المرور" }).fill(PASSWORD);
    await page.getByRole("button", { name: "تسجيل الدخول" }).click();
    await expect(page.getByRole("alert").filter({ hasText: /غير صحيحة/ })).toBeVisible();
  });

  test("the owner of a venue is told what to do first, with no form", async ({ page }) => {
    const owner = await createAuthUser("Owner");
    await rpc(owner.id, "create_venue", { p_name: "ملعب الاختبار", p_city_id: await mosul() });
    await signIn(page, owner);
    await page.goto("/ar/settings");
    const section = page.getByRole("region", { name: "حذف الحساب" });
    await expect(section.getByText(/أنت مالك ملعب: ملعب الاختبار/)).toBeVisible();
    await expect(section.getByRole("button", { name: "حذف حسابي نهائياً" })).toHaveCount(0);
  });

  test("the public page explains how, for those without the app", async ({ page }) => {
    await page.goto("/ar/legal/account-deletion");
    await expect(page.getByRole("heading", { name: "حذف حسابك في «الملعب»", level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "كيف تحذف حسابك" })).toBeVisible();
  });
});
