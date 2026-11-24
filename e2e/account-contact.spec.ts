import { randomUUID } from "node:crypto";
import { admin, createAuthUser, emailedCode, expect, PASSWORD, signIn, test, type TestUser, whatsappMessage } from "./fixtures";

const phone = () => `9647${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`;
const localFormat = (e164: string) => `0${e164.slice(3)}`;
const newEmail = () => `e2e-new-${randomUUID().slice(0, 8)}@example.test`;

/** An account made with WhatsApp: an internal address (it receives nothing) and a verified number. */
async function whatsappAccount(name: string): Promise<TestUser & { phone: string }> {
  const user = await createAuthUser(name);
  const internal = `wa_${randomUUID().replace(/-/g, "")}@phone.malaab.invalid`;
  const number = phone();
  await admin("update auth.users set email = $2 where id = $1", [user.id, internal]);
  await admin("update auth.identities set identity_data = identity_data || jsonb_build_object('email', $2::text) where user_id = $1", [user.id, internal]);
  await admin("insert into private.user_phones (user_id, phone) values ($1, $2)", [user.id, number]);
  return { ...user, email: internal, phone: number };
}

async function signInWithNumber(page: import("@playwright/test").Page, number: string) {
  await page.goto("/ar/sign-in");
  await page.getByRole("textbox", { name: "رقم واتساب" }).fill(localFormat(number));
  await page.getByRole("textbox", { name: "كلمة المرور" }).fill(PASSWORD);
  await page.getByRole("button", { name: "تسجيل الدخول" }).click();
  await page.waitForURL(/\/ar\/dashboard/);
}

/** Adding or changing the e-mail and the phone number (settings; migrations 0046–0047). */
test.describe("Account e-mail and number", () => {
  test("an e-mail account changes its address: the password first, then the code sent to the new one", async ({ page }) => {
    const me = await createAuthUser("Mover");
    const next = newEmail();
    await signIn(page, me);
    await page.goto("/ar/settings");
    const section = page.getByRole("region", { name: "تغيير البريد الإلكتروني" });
    await section.getByRole("textbox", { name: "البريد الجديد" }).fill(next);
    await section.getByLabel("كلمة المرور الحالية").fill("not-my-password");
    await section.getByRole("button", { name: "إرسال رمز التأكيد" }).click();
    await expect(section.getByText("كلمة المرور غير صحيحة.")).toBeVisible();
    await section.getByLabel("كلمة المرور الحالية").fill(PASSWORD);
    await section.getByRole("button", { name: "إرسال رمز التأكيد" }).click();
    await expect(section.getByText(`أرسلنا رمزاً إلى ${next}. أدخله هنا لتأكيد البريد الجديد.`)).toBeVisible();

    await section.getByRole("textbox", { name: "رمز التأكيد" }).first().fill("000000");
    await section.getByRole("button", { name: "تأكيد", exact: true }).click();
    await expect(section.getByText("الرمز غير صحيح", { exact: false })).toBeVisible();
    await section.getByRole("textbox", { name: "رمز التأكيد" }).first().fill(await emailedCode(next));
    await section.getByRole("button", { name: "تأكيد", exact: true }).click();
    await page.waitForURL(/\/ar\/settings\?email=changed/);
    await expect(page.getByText("تم تغيير بريدك الإلكتروني. سجّل الدخول به من الآن.")).toBeVisible();
    // Told in the notifications, in case it wasn't them.
    expect(await admin("select 1 from public.notifications where user_id = $1 and type = 'email_changed'", [me.id])).toHaveLength(1);

    // The new address signs in; the old one doesn't.
    await page.context().clearCookies();
    await signIn(page, { ...me, email: next });
    await page.context().clearCookies();
    await page.goto("/ar/sign-in?method=email");
    await page.getByRole("textbox", { name: "البريد الإلكتروني" }).fill(me.email);
    await page.getByRole("textbox", { name: "كلمة المرور" }).fill(PASSWORD);
    await page.getByRole("button", { name: "تسجيل الدخول" }).click();
    await expect(page.getByRole("alert").filter({ hasText: /غير صحيحة/ })).toBeVisible();
  });

  test("a WhatsApp account adds an e-mail, and still signs in with its number", async ({ page }) => {
    const me = await whatsappAccount("No mail");
    const mail = newEmail();
    await signInWithNumber(page, me.phone);
    await page.goto("/ar/settings");
    const section = page.getByRole("region", { name: "إضافة بريد إلكتروني" });
    await section.getByRole("textbox", { name: "البريد الجديد" }).fill(mail);
    await section.getByLabel("كلمة المرور الحالية").fill(PASSWORD);
    await section.getByRole("button", { name: "إرسال رمز التأكيد" }).click();
    await section.getByRole("textbox", { name: "رمز التأكيد" }).first().fill(await emailedCode(mail));
    await section.getByRole("button", { name: "تأكيد", exact: true }).click();
    await page.waitForURL(/\/ar\/settings\?email=changed/);
    await expect(page.getByText("تم تغيير بريدك الإلكتروني. سجّل الدخول به من الآن.")).toBeVisible();
    await page.reload();
    await expect(page.getByRole("region", { name: "الحساب" }).getByText(mail)).toBeVisible();

    await page.context().clearCookies();
    await signInWithNumber(page, me.phone);
    await page.context().clearCookies();
    await signIn(page, { ...me, email: mail });
  });

  test("a member adds a number by sending the code from its WhatsApp, then signs in with it", async ({ page, baseURL }) => {
    const me = await createAuthUser("Adds number");
    const number = phone();
    await signIn(page, me);
    await page.goto("/ar/settings");
    const section = page.getByRole("region", { name: "إضافة رقم هاتف" });
    await section.getByRole("textbox", { name: "رقم واتساب الجديد" }).fill(localFormat(number));
    await section.getByLabel("كلمة المرور الحالية").fill(PASSWORD);
    await section.getByRole("button", { name: "تأكيد عبر واتساب" }).click();
    await page.waitForURL(/\/ar\/verify-whatsapp/);
    await expect(page.getByText("أرسل الرمز من واتساب رقمك الجديد لربطه بحسابك.")).toBeVisible();
    const code = (await page.getByTestId("verify-code").textContent())!.trim();
    // From another number: refused, the code stays waiting.
    expect((await whatsappMessage(baseURL!, phone(), code)).reply).toContain("ليست من واتساب هذا الرقم");
    expect((await whatsappMessage(baseURL!, number, code)).reply).toContain("تم ربط هذا الرقم بحسابك");
    await page.waitForURL(/\/ar\/settings\?phone=changed/, { timeout: 15_000 });
    await expect(page.getByText("تم تحديث رقم هاتفك. يمكنك تسجيل الدخول به من الآن.")).toBeVisible();
    await expect(page.getByRole("region", { name: "الحساب" }).getByText(`+${number}`)).toBeVisible();
    await expect(page.getByRole("region", { name: "تغيير رقم الهاتف" })).toBeVisible();

    await page.context().clearCookies();
    await signInWithNumber(page, number);
  });

  test("a number another account has is refused at once", async ({ page }) => {
    const [me, owner] = [await createAuthUser("Wants it"), await whatsappAccount("Has it")];
    await signIn(page, me);
    await page.goto("/ar/settings");
    const section = page.getByRole("region", { name: "إضافة رقم هاتف" });
    await section.getByRole("textbox", { name: "رقم واتساب الجديد" }).fill(localFormat(owner.phone));
    await section.getByLabel("كلمة المرور الحالية").fill(PASSWORD);
    await section.getByRole("button", { name: "تأكيد عبر واتساب" }).click();
    await expect(section.getByText("هذا الرقم مرتبط بحساب آخر في «الملعب».")).toBeVisible();
  });
});
