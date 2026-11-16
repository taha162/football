import { randomInt, randomUUID } from "node:crypto";
import { admin, createAuthUser, emailedCode, emailedHtml, expect, PASSWORD, quietWhatsapp, test } from "./fixtures";

const phone = () => `9647${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`;
const localFormat = (e164: string) => `0${e164.slice(3)}`;

test.describe("Account verification", () => {
  test("e-mail: signing up with an address that already has an account says so, instead of waiting for a code", async ({ page }) => {
    const existing = await createAuthUser("Existing");
    await page.goto("/ar/sign-up");
    await page.getByRole("textbox", { name: "الاسم الظاهر" }).fill("لاعب مكرر");
    await page.getByRole("textbox", { name: "البريد الإلكتروني" }).fill(existing.email);
    await page.getByRole("textbox", { name: "كلمة المرور" }).fill(PASSWORD);
    await page.getByRole("checkbox", { name: /شروط الاستخدام/ }).check();
    await page.getByRole("button", { name: "إنشاء حساب" }).click();
    await expect(page.getByText("يوجد حساب بهذا البريد الإلكتروني بالفعل.")).toBeVisible();
    await expect(page).toHaveURL(/\/ar\/sign-up/);
    // What was typed stays (only the password is cleared), so it's quick to correct.
    await expect(page.getByRole("textbox", { name: "الاسم الظاهر" })).toHaveValue("لاعب مكرر");
    await expect(page.getByRole("textbox", { name: "البريد الإلكتروني" })).toHaveValue(existing.email);
    await expect(page.getByRole("textbox", { name: "كلمة المرور" })).toHaveValue("");
    await expect(page.getByRole("checkbox")).toBeChecked();
  });

  test("guessing a password: after ten wrong ones the account pauses, even for the right one", async ({ page }) => {
    test.setTimeout(90_000);
    const user = await createAuthUser("Guarded");
    await page.goto("/ar/sign-in");
    const login = page.getByRole("textbox", { name: /^البريد الإلكتروني/ });
    const pass = page.getByRole("textbox", { name: "كلمة المرور" });
    await login.fill(user.email);
    for (let i = 0; i < 10; i++) {
      await pass.fill(`wrong-password-${i}`);
      // Each attempt's own answer (the sign-in is a POST to this page).
      await Promise.all([
        page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/ar/sign-in"),
        page.getByRole("button", { name: "تسجيل الدخول" }).click(),
      ]);
      await expect(page.getByText("البريد الإلكتروني أو كلمة المرور غير صحيحة.")).toBeVisible();
      // A wrong password keeps the e-mail typed, and empties only the password.
      await expect(login).toHaveValue(user.email);
      await expect(pass).toHaveValue("");
    }
    await pass.fill(PASSWORD);
    await page.getByRole("button", { name: "تسجيل الدخول" }).click();
    await expect(page.getByText(/^محاولات كثيرة من هذا الجهاز أو لهذا الحساب/)).toBeVisible();
    await expect(page).toHaveURL(/\/ar\/sign-in/);
  });

  test("e-mail: a user who signs in before confirming is sent to the code page, can resend and verify", async ({ page }) => {
    const email = `e2e-code-${randomUUID().slice(0, 8)}@example.test`;
    await page.goto("/ar/sign-up");
    await page.getByRole("textbox", { name: "الاسم الظاهر" }).fill("لاعب الرمز");
    await page.getByRole("textbox", { name: "البريد الإلكتروني" }).fill(email);
    await page.getByRole("textbox", { name: "كلمة المرور" }).fill(PASSWORD);
    await page.getByRole("checkbox", { name: /شروط الاستخدام/ }).check();
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

  test("phone sign-up: past the per-device limit, no account is created at all", async ({ browser }) => {
    // A device of its own (an address only this test uses), and a limit of two sign-ups for it.
    const ip = `203.0.113.${randomInt(1, 255)}`;
    const tag = `Throttle ${randomUUID().slice(0, 8)}`;
    const [setting] = await admin<{ value: unknown }>("select value from public.platform_settings where key = 'auth.signups_per_device'");
    await admin("update public.platform_settings set value = '2'::jsonb where key = 'auth.signups_per_device'");
    const context = await browser.newContext({ extraHTTPHeaders: { "x-real-ip": ip } });
    await quietWhatsapp(context);
    try {
      for (let i = 1; i <= 3; i++) {
        const page = await context.newPage();
        await page.goto("/ar/sign-up?method=whatsapp");
        await page.getByRole("textbox", { name: "الاسم الظاهر" }).fill(tag);
        await page.getByRole("textbox", { name: "رقم واتساب" }).fill(localFormat(phone()));
        await page.getByRole("textbox", { name: "كلمة المرور" }).fill(PASSWORD);
        await page.getByRole("checkbox", { name: /شروط الاستخدام/ }).check();
        await page.getByRole("button", { name: "متابعة عبر واتساب" }).click();
        if (i <= 2) await page.waitForURL(/\/ar\/verify-whatsapp/);
        else await expect(page.getByText("محاولات كثيرة من هذا الجهاز")).toBeVisible();
        await page.close();
      }
      // The refused attempt never reached Supabase Auth: two accounts, not three.
      const [{ n }] = await admin<{ n: number }>("select count(*)::int as n from auth.users where raw_user_meta_data->>'display_name' = $1", [tag]);
      expect(n).toBe(2);
    } finally {
      await admin("update public.platform_settings set value = $1::jsonb where key = 'auth.signups_per_device'", [JSON.stringify(setting?.value ?? 20)]);
      await context.close();
    }
  });

  test("Telegram is gone: no sign-up option, no recovery button, no waiting page, no webhook", async ({ page, baseURL }) => {
    await page.goto("/ar/sign-up?method=telegram");
    await expect(page.getByRole("textbox", { name: "البريد الإلكتروني" })).toBeVisible(); // the e-mail form instead
    await expect(page.getByText("تيليغرام")).toHaveCount(0);
    await page.goto("/ar/forgot-password");
    await expect(page.getByRole("button", { name: "استعادة عبر واتساب" })).toBeVisible();
    await expect(page.getByText("تيليغرام")).toHaveCount(0);
    // The site's not-found page (streamed, so like every unknown page it is sent with status 200).
    await page.goto("/ar/verify-telegram");
    await expect(page.getByText("الصفحة غير موجودة")).toBeVisible();
    expect((await fetch(`${baseURL}/api/telegram/webhook`, { method: "POST", body: "{}" })).status).toBe(404);
  });
});
