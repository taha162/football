import { admin, createAuthUser, expect, PASSWORD, test } from "./fixtures";

/** A test number in Iraq's E.164 form, and as people type it. */
const phone = () => `9647${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`;
const localFormat = (e164: string) => `0${e164.slice(3)}`;

test.describe("Signing in: WhatsApp number first, e-mail the other way", () => {
  test("the number comes first, the eye shows the password, and e-mail is one tap away, keeping where to go next", async ({ page }) => {
    const user = await createAuthUser("Number first");
    const number = phone();
    await admin("insert into private.user_phones (user_id, phone) values ($1, $2)", [user.id, number]);

    await page.goto("/ar/sign-in?next=/notifications");
    const numberField = page.getByRole("textbox", { name: "رقم واتساب" });
    const password = page.getByRole("textbox", { name: "كلمة المرور" });
    const eye = page.getByRole("button", { name: "إظهار كلمة المرور" });
    await expect(numberField).toBeVisible();
    await expect(page.getByRole("textbox", { name: "البريد الإلكتروني" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "نسيتها؟" })).toBeVisible();

    // The eye shows what was typed.
    await numberField.fill(localFormat(number));
    await password.fill("Wrong-pass-999");
    await expect(password).toHaveAttribute("type", "password");
    await eye.click();
    await expect(password).toHaveAttribute("type", "text");
    await expect(eye).toHaveAttribute("aria-pressed", "true");
    // A wrong password is said about the number; the number stays, the password doesn't, even while shown.
    await page.getByRole("button", { name: "تسجيل الدخول" }).click();
    await expect(page.getByText("رقم واتساب أو كلمة المرور غير صحيحة.")).toBeVisible();
    await expect(numberField).toHaveValue(localFormat(number));
    await expect(password).toHaveValue("");
    // And hides it again.
    await eye.click();
    await expect(password).toHaveAttribute("type", "password");
    await expect(eye).toHaveAttribute("aria-pressed", "false");
    await password.fill(PASSWORD);
    await page.getByRole("button", { name: "تسجيل الدخول" }).click();
    await page.waitForURL(/\/ar\/notifications/);

    // Signed out: «المتابعة بالبريد الإلكتروني» swaps the form, and the page to go to next stays.
    await page.context().clearCookies();
    await page.goto("/ar/sign-in?next=/notifications");
    await page.getByRole("link", { name: "المتابعة بالبريد الإلكتروني" }).click();
    await page.waitForURL(/method=email/);
    expect(new URL(page.url()).searchParams.get("next")).toBe("/notifications");
    await expect(page.getByRole("textbox", { name: "رقم واتساب" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "المتابعة برقم واتساب" })).toBeVisible();
    await page.getByRole("textbox", { name: "البريد الإلكتروني" }).fill(user.email);
    await page.getByRole("textbox", { name: "كلمة المرور" }).fill(PASSWORD);
    await page.getByRole("button", { name: "تسجيل الدخول" }).click();
    await page.waitForURL(/\/ar\/notifications/);
  });

  test("signing up and recovering a password lead with WhatsApp too", async ({ page }) => {
    await page.goto("/ar/sign-up");
    await expect(page.getByRole("textbox", { name: "رقم واتساب" })).toBeVisible();
    await page.getByRole("link", { name: "إنشاء حساب بالبريد الإلكتروني" }).click();
    await page.waitForURL(/method=email/);
    await expect(page.getByRole("textbox", { name: "البريد الإلكتروني" })).toBeVisible();
    await expect(page.getByRole("link", { name: "إنشاء حساب برقم واتساب" })).toBeVisible();

    await page.goto("/ar/forgot-password");
    const byNumber = await page.getByRole("textbox", { name: "رقم واتساب" }).boundingBox();
    const byEmail = await page.getByRole("textbox", { name: "البريد الإلكتروني" }).boundingBox();
    expect(byNumber!.y).toBeLessThan(byEmail!.y);
  });
});
