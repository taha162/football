import { randomUUID } from "node:crypto";
import { createAuthUser, emailedCode, emailedHtml, expect, PASSWORD, telegramMessage, telegramUser, test, verifyWithTelegram } from "./fixtures";

const phone = () => `9647${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`;
const localFormat = (e164: string) => `0${e164.slice(3)}`;

test.describe("Account verification", () => {
  test("e-mail: signing up with an address that already has an account says so, instead of waiting for a code", async ({ page }) => {
    const existing = await createAuthUser("Existing");
    await page.goto("/ar/sign-up");
    await page.getByRole("textbox", { name: "الاسم الظاهر" }).fill("لاعب مكرر");
    await page.getByRole("textbox", { name: "البريد الإلكتروني" }).fill(existing.email);
    await page.getByRole("textbox", { name: "كلمة المرور" }).fill(PASSWORD);
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "إنشاء حساب" }).click();
    await expect(page.getByText("يوجد حساب بهذا البريد الإلكتروني بالفعل.")).toBeVisible();
    await expect(page).toHaveURL(/\/ar\/sign-up/);
  });

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
    // The code e-mail carries no links: links to another domain look like phishing to spam filters.
    expect(await emailedHtml(email)).not.toContain("href=");

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

  test("Telegram: sign up by sharing the number with the bot, then sign in and recover the password with it", async ({ page, baseURL }) => {
    const from = phone();
    const me = telegramUser();
    await page.goto("/en/sign-up");
    await page.getByRole("link", { name: "With Telegram" }).click();
    await page.waitForURL(/method=telegram/);
    await page.getByRole("textbox", { name: "Display name" }).fill("Telegram Player");
    await page.getByRole("textbox", { name: "Password" }).fill(PASSWORD);
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Continue with Telegram" }).click();
    await page.waitForURL(/\/en\/verify-telegram/);

    const code = (await page.getByTestId("verify-code").textContent())!.trim();
    expect(code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    await expect(page.getByRole("link", { name: "Open Telegram" })).toHaveAttribute("data-href", `https://t.me/AlMalabTestBot?start=${code}`);

    // Requests without the webhook's secret token are refused.
    expect((await telegramMessage(baseURL!, me, { text: `/start ${code}` }, "wrong-secret")).status).toBe(401);

    // The start link opens the bot, which asks for the number with a button, and the page notices.
    const started = await telegramMessage(baseURL!, me, { text: `/start ${code}` });
    expect(started).toMatchObject({ status: 200, method: "sendMessage", chat_id: me });
    expect(started.reply_markup?.keyboard?.[0]?.[0]).toMatchObject({ request_contact: true });
    await expect(page.getByText("The bot is open.", { exact: false })).toBeVisible({ timeout: 10_000 });

    // Someone else's contact card proves nothing.
    const foreign = await telegramMessage(baseURL!, me, { contact: { phone_number: phone(), first_name: "Friend", user_id: telegramUser() } });
    expect(foreign.text).toContain("share your own number");

    // Their own contact: the number is verified and the page carries on by itself.
    const shared = await telegramMessage(baseURL!, me, { contact: { phone_number: `+${from}`, first_name: "E2E", user_id: me } });
    expect(shared.text).toContain("Your number is verified");
    expect(shared.reply_markup).toMatchObject({ remove_keyboard: true });
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
    await page.getByRole("textbox", { name: "E-mail or phone number" }).fill(localFormat(from));
    await page.getByRole("textbox", { name: "Password" }).fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(/\/en\/dashboard/);

    // Forgot password → recover with Telegram, sharing the same number.
    await page.context().clearCookies();
    await page.goto("/en/forgot-password");
    await page.getByRole("button", { name: "Recover with Telegram" }).click();
    await page.waitForURL(/\/en\/verify-telegram/);
    const resetCode = (await page.getByTestId("verify-code").textContent())!.trim();
    expect((await verifyWithTelegram(baseURL!, me, resetCode, from)).text).toContain("choose a new password");
    await page.waitForURL(/\/en\/reset-password/, { timeout: 15_000 });
    await page.getByRole("textbox", { name: "New password" }).fill("N3w-pass-4567");
    await page.getByRole("textbox", { name: "Confirm password" }).fill("N3w-pass-4567");
    await page.getByRole("button", { name: "Save password" }).click();
    await page.waitForURL(/\/en\/dashboard/);

    await page.context().clearCookies();
    await page.goto("/en/sign-in");
    await page.getByRole("textbox", { name: "E-mail or phone number" }).fill(`+${from}`);
    await page.getByRole("textbox", { name: "Password" }).fill("N3w-pass-4567");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(/\/en\/dashboard/);
  });

  test("Telegram: a number that already has an account cannot be used to create another", async ({ page, baseURL, browser }) => {
    const from = phone();
    const signUp = async (p: typeof page) => {
      await p.goto("/ar/sign-up?method=telegram");
      await p.getByRole("textbox", { name: "الاسم الظاهر" }).fill("مرتين");
      await p.getByRole("textbox", { name: "كلمة المرور" }).fill(PASSWORD);
      await p.getByRole("checkbox").check();
      await p.getByRole("button", { name: "متابعة عبر تيليغرام" }).click();
      await p.waitForURL(/\/ar\/verify-telegram/);
      return (await p.getByTestId("verify-code").textContent())!.trim();
    };
    await verifyWithTelegram(baseURL!, telegramUser(), await signUp(page), from);
    await page.waitForURL(/\/ar\/onboarding/, { timeout: 15_000 });

    const other = await (await browser.newContext()).newPage();
    const reply = await verifyWithTelegram(baseURL!, telegramUser(), await signUp(other), from);
    expect(reply.text).toContain("هذا الرقم مرتبط بحساب آخر");
    await expect(other.getByText("هذا الرقم مرتبط بحساب آخر في «الملعب».")).toBeVisible({ timeout: 15_000 });
  });

  test("Telegram bot: refuses unsigned updates and guides people who arrive without a valid code", async ({ baseURL }) => {
    const me = telegramUser();
    expect((await telegramMessage(baseURL!, me, { text: "/start" }, "")).status).toBe(401);
    const help = await telegramMessage(baseURL!, me, { text: "/start" });
    expect(help).toMatchObject({ status: 200, method: "sendMessage", chat_id: me });
    expect(help.text).toContain("verification bot");
    expect((await telegramMessage(baseURL!, me, { text: "/start ZZZZ-ZZZZ" })).text).toContain("invalid or has expired");
    // A contact with no code opened first completes nothing.
    const stray = await telegramMessage(baseURL!, me, { contact: { phone_number: phone(), first_name: "E2E", user_id: me } });
    expect(stray.text).toContain("Open the Telegram link");
  });
});
