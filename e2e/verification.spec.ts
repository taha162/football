import { randomUUID } from "node:crypto";
import { admin, emailedCode, expect, PASSWORD, test, whatsappInbound } from "./fixtures";

const phone = () => `9647${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`;
const localFormat = (e164: string) => `0${e164.slice(3)}`;

// All local runs share one client IP, so lift the per-client WhatsApp start
// limit (10/hour by default, DB-tested separately) while this file runs.
test.beforeAll(() => admin("update public.platform_settings set value = '1000' where key = 'whatsapp.max_starts_per_hour'"));
test.afterAll(() => admin("update public.platform_settings set value = '10' where key = 'whatsapp.max_starts_per_hour'"));

test.describe("Account verification", () => {
  test("e-mail: a user who signs in before confirming is sent to the code page, can resend and verify", async ({ page }) => {
    const email = `e2e-code-${randomUUID().slice(0, 8)}@example.test`;
    await page.goto("/ar/sign-up");
    await page.getByRole("textbox", { name: "الاسم الظاهر" }).fill("لاعب الرمز");
    await page.getByRole("textbox", { name: "البريد الإلكتروني" }).fill(email);
    await page.getByRole("textbox", { name: "كلمة المرور" }).fill(PASSWORD);
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "إنشاء حساب" }).click();
    await page.waitForURL(/\/ar\/verify-email/);
    const firstCode = await emailedCode(email);

    // Leave and sign in instead: the account is not confirmed yet.
    await page.goto("/ar/sign-in");
    await page.getByRole("textbox", { name: /البريد الإلكتروني/ }).fill(email);
    await page.getByRole("textbox", { name: "كلمة المرور" }).fill(PASSWORD);
    await page.getByRole("button", { name: "تسجيل الدخول" }).click();
    await page.waitForURL(/\/ar\/verify-email/);

    // Supabase spaces out code e-mails (1 s locally, 60 s by default in production).
    await page.waitForTimeout(1500);
    await page.getByRole("button", { name: "أعد إرسال الرمز" }).click();
    await expect(page.getByText("أرسلنا رمزًا جديدًا إلى بريدك.")).toBeVisible();
    await expect.poll(() => emailedCode(email)).not.toBe(firstCode);
    await page.getByRole("textbox", { name: "رمز التحقق" }).fill(await emailedCode(email));
    await page.getByRole("button", { name: "تأكيد" }).click();
    await page.waitForURL(/\/ar\/onboarding/);
  });

  test("WhatsApp: sign up by sending a code, then sign in and recover the password with the same number", async ({ page, baseURL }) => {
    const from = phone();
    await page.goto("/en/sign-up");
    await page.getByRole("link", { name: "With WhatsApp" }).click();
    await page.waitForURL(/method=whatsapp/);
    await expect(page.getByRole("button", { name: "Continue with WhatsApp" })).toBeVisible();
    await page.getByRole("textbox", { name: "Display name" }).fill("WhatsApp Player");
    await page.getByRole("textbox", { name: "Password" }).fill(PASSWORD);
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Continue with WhatsApp" }).click();
    await page.waitForURL(/\/en\/verify-whatsapp/);

    const code = (await page.getByTestId("wa-code").textContent())!.trim();
    expect(code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    const open = page.getByRole("link", { name: "Open WhatsApp and send the code" });
    await expect(open).toHaveAttribute("data-href", new RegExp(`^https://wa\\.me/9647700000000\\?text=.*${code}`));

    // Unsigned or wrongly signed requests are rejected.
    expect((await whatsappInbound(baseURL!, from, code, "wrong-secret")).status).toBe(401);
    // The user sends the pre-filled message; Meta delivers it to the webhook.
    expect((await whatsappInbound(baseURL!, from, `Malaab verification code: ${code}`)).status).toBe(200);
    await page.waitForURL(/\/en\/onboarding/, { timeout: 15_000 });

    await page.getByText("Goalkeeper", { exact: true }).click();
    await page.getByText("Intermediate", { exact: true }).click();
    await page.getByRole("button", { name: "Start playing" }).click();
    await page.waitForURL(/\/en\/dashboard/);
    await page.goto("/en/settings");
    await expect(page.getByText(`+${from}`)).toBeVisible();

    // Sign out, then sign in with the local number format and the password.
    await page.context().clearCookies();
    await page.goto("/en/sign-in");
    await page.getByRole("textbox", { name: "E-mail or WhatsApp number" }).fill(localFormat(from));
    await page.getByRole("textbox", { name: "Password" }).fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(/\/en\/dashboard/);

    // Forgot password → recover with WhatsApp from the same number.
    await page.context().clearCookies();
    await page.goto("/en/forgot-password");
    await page.getByRole("button", { name: "Recover with WhatsApp" }).click();
    await page.waitForURL(/\/en\/verify-whatsapp/);
    const resetCode = (await page.getByTestId("wa-code").textContent())!.trim();
    expect((await whatsappInbound(baseURL!, from, resetCode)).status).toBe(200);
    await page.waitForURL(/\/en\/reset-password/, { timeout: 15_000 });
    await page.getByRole("textbox", { name: "New password" }).fill("N3w-pass-4567");
    await page.getByRole("textbox", { name: "Confirm password" }).fill("N3w-pass-4567");
    await page.getByRole("button", { name: "Save password" }).click();
    await page.waitForURL(/\/en\/dashboard/);

    await page.context().clearCookies();
    await page.goto("/en/sign-in");
    await page.getByRole("textbox", { name: "E-mail or WhatsApp number" }).fill(`+${from}`);
    await page.getByRole("textbox", { name: "Password" }).fill("N3w-pass-4567");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(/\/en\/dashboard/);
  });

  test("WhatsApp: a number that already has an account cannot be used to create another", async ({ page, baseURL, browser }) => {
    const from = phone();
    const signUp = async (p: typeof page) => {
      await p.goto("/en/sign-up?method=whatsapp");
      await p.getByRole("textbox", { name: "Display name" }).fill("Twice");
      await p.getByRole("textbox", { name: "Password" }).fill(PASSWORD);
      await p.getByRole("checkbox").check();
      await p.getByRole("button", { name: "Continue with WhatsApp" }).click();
      await p.waitForURL(/\/en\/verify-whatsapp/);
      return (await p.getByTestId("wa-code").textContent())!.trim();
    };
    await whatsappInbound(baseURL!, from, await signUp(page));
    await page.waitForURL(/\/en\/onboarding/, { timeout: 15_000 });

    const other = await (await browser.newContext()).newPage();
    await whatsappInbound(baseURL!, from, await signUp(other));
    await expect(other.getByText("This number already has a Malaab account.")).toBeVisible({ timeout: 15_000 });
  });

  test("WhatsApp webhook answers Meta's verification handshake only with the right token", async ({ request }) => {
    const ok = await request.get("/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=local-verify-token&hub.challenge=12345");
    expect(ok.status()).toBe(200);
    expect(await ok.text()).toBe("12345");
    const bad = await request.get("/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=12345");
    expect(bad.status()).toBe(403);
  });
});
