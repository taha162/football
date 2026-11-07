import type { Page } from "@playwright/test";
import { admin, createAuthUser, expect, passwordSession, PASSWORD, signIn, test, totp, turnOnSecondFactor, wrongCode, type TestUser } from "./fixtures";

const WRONG = "الرمز غير صحيح أو انتهت صلاحيته.";

/** The sign-in form, without waiting for the dashboard (with an app, the code page comes first). */
async function enterPassword(page: Page, user: TestUser) {
  await page.goto("/ar/sign-in?next=/notifications");
  await page.getByRole("textbox", { name: /^البريد الإلكتروني/ }).fill(user.email);
  await page.getByRole("textbox", { name: "كلمة المرور" }).fill(PASSWORD);
  await page.getByRole("button", { name: "تسجيل الدخول" }).click();
}

test.describe("Two-step verification", () => {
  test("turned on in Settings, every sign-in needs the app's code, and the password alone opens nothing", async ({ page }) => {
    const user = await createAuthUser("TwoStep");
    await signIn(page, user);
    await page.goto("/ar/settings");
    await page.getByRole("button", { name: "تفعيل التحقق بخطوتين" }).click();
    await expect(page.getByRole("img", { name: /رمز QR/ })).toBeVisible();
    const secret = (await page.getByTestId("second-factor-key").innerText()).replace(/\s/g, "");

    // The first code confirms the app; a wrong one is refused.
    const setupCode = page.getByRole("textbox", { name: "الرمز من التطبيق" });
    await setupCode.fill(wrongCode(secret));
    await page.getByRole("button", { name: "تأكيد وتفعيل" }).click();
    await expect(page.getByText(WRONG)).toBeVisible();
    await setupCode.fill(totp(secret));
    await page.getByRole("button", { name: "تأكيد وتفعيل" }).click();
    await expect(page.getByText("مفعّل", { exact: true })).toBeVisible();

    // Signing in again: the password is only the first step.
    await page.getByRole("button", { name: "تسجيل الخروج" }).first().click();
    await page.waitForURL(/\/ar\/?$/);
    await enterPassword(page, user);
    await page.waitForURL(/\/ar\/mfa\?next=%2Fnotifications/);
    await page.goto("/ar/dashboard");
    await expect(page).toHaveURL(/\/ar\/mfa\?next=%2Fdashboard/);

    // Straight through the API with the password only: no data, every action refused.
    const api = await passwordSession(user);
    expect((await api.from("profiles").select("id").eq("id", user.id)).data).toEqual([]);
    expect((await api.from("cities").select("id").limit(1)).data).toEqual([]);
    expect((await api.rpc("mark_notifications_read", { p_ids: null })).error?.message).toBe("mfa_required");
    expect((await api.auth.updateUser({ password: "Another-pass-456" })).error?.code).toBe("insufficient_aal");

    // The code page: a wrong code is refused, the right one opens the page asked for.
    const code = page.getByRole("textbox", { name: "رمز التطبيق" });
    await code.fill(wrongCode(secret));
    await page.getByRole("button", { name: "تأكيد", exact: true }).click();
    await expect(page.getByText(WRONG)).toBeVisible();
    await code.fill(totp(secret));
    await page.getByRole("button", { name: "تأكيد", exact: true }).click();
    await page.waitForURL(/\/ar\/dashboard/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    // Turning it off takes a current code too.
    await page.goto("/ar/settings");
    const off = page.getByRole("textbox", { name: "لإيقافه اكتب رمزًا من التطبيق" });
    await off.fill(wrongCode(secret));
    await page.getByRole("button", { name: "إيقاف التحقق بخطوتين" }).click();
    await expect(page.getByText(WRONG)).toBeVisible();
    await off.fill(totp(secret));
    await page.getByRole("button", { name: "إيقاف التحقق بخطوتين" }).click();
    await expect(page.getByRole("button", { name: "تفعيل التحقق بخطوتين" })).toBeVisible();
    const after = await passwordSession(user);
    expect((await after.from("profiles").select("id").eq("id", user.id)).data).toHaveLength(1);
  });

  test("an admin resets it for someone who lost their phone, and it's recorded", async ({ page, browser }) => {
    const [boss, lost] = [await createAuthUser("Boss", { admin: true }), await createAuthUser("LostPhone")];
    await turnOnSecondFactor(lost);
    await signIn(page, boss);
    await page.goto(`/ar/admin/users?q=${encodeURIComponent(lost.name)}`);
    // Staff without two-step verification are told to turn it on.
    await expect(page.getByText("حسابك يملك صلاحيات إدارية، ففعّل التحقق بخطوتين لحمايته.")).toBeVisible();

    const row = page.getByRole("row").filter({ hasText: lost.name });
    await expect(row.getByText("تحقق بخطوتين", { exact: true })).toBeVisible();
    await row.getByRole("button", { name: "إعادة ضبط التحقق بخطوتين" }).click();
    const dialog = page.getByRole("dialog", { name: "إعادة ضبط التحقق بخطوتين" });
    await dialog.getByRole("textbox").fill("Lost phone, owner confirmed by call");
    await dialog.getByRole("button", { name: "إعادة ضبط التحقق بخطوتين" }).click();
    // The list refreshes: no app on the account any more, so no reset button either.
    await expect(page.getByRole("row").filter({ hasText: lost.name }).getByText("تحقق بخطوتين", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("row").filter({ hasText: lost.name }).getByRole("button", { name: "إعادة ضبط التحقق بخطوتين" })).toHaveCount(0);

    // They sign in with the password alone again (straight to the dashboard).
    const ctx = await browser.newContext();
    await signIn(await ctx.newPage(), lost);
    await ctx.close();
    const audit = await admin<{ actor_id: string; details: { reason: string } }>(
      "select actor_id, details from public.audit_logs where action = 'second_factor_reset' and entity_id = $1",
      [lost.id],
    );
    expect(audit).toEqual([{ actor_id: boss.id, details: { reason: "Lost phone, owner confirmed by call" } }]);
  });
});
