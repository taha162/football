import { createAuthUser, expect, signIn, test } from "./fixtures";

test.describe("Account menu", () => {
  test("the picture opens who is signed in and their pages; keys, a click elsewhere and another page close it", async ({ page }) => {
    const user = await createAuthUser("Menu", { admin: true });
    await signIn(page, user);
    const trigger = page.getByRole("button", { name: `قائمة حساب ${user.name}` });
    await expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    await expect(trigger).toHaveAttribute("aria-expanded", "false");

    // Who is signed in, then their pages, what they manage, and signing out; the first item takes the focus.
    await trigger.click();
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    const menu = page.getByRole("menu");
    await expect(menu.getByText(user.name, { exact: true })).toBeVisible();
    await expect(menu.getByTestId("account-contact")).toHaveText(user.email);
    await expect(menu.getByRole("menuitem")).toHaveText(["لوحتي", "ملفي الشخصي", "أصدقائي", "فرقي", "حجوزاتي", "الإعدادات", "الإدارة", "تسجيل الخروج"]);
    await expect(menu.getByRole("menuitem", { name: "لوحتي" })).toBeFocused();

    // ↑ from the first goes round to the last, Home back to the first; Escape closes it and returns to the picture.
    await page.keyboard.press("ArrowUp");
    await expect(menu.getByRole("menuitem", { name: "تسجيل الخروج" })).toBeFocused();
    await page.keyboard.press("Home");
    await expect(menu.getByRole("menuitem", { name: "لوحتي" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAttribute("aria-expanded", "false");

    // ↓ on the picture opens it; Enter on an item goes there, and the menu is closed on the new page.
    await page.keyboard.press("ArrowDown");
    await expect(menu.getByRole("menuitem", { name: "لوحتي" })).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(menu.getByRole("menuitem", { name: "ملفي الشخصي" })).toBeFocused();
    await page.keyboard.press("Enter");
    await page.waitForURL(/\/ar\/profile/);
    await expect(menu).toHaveCount(0);

    // A click elsewhere closes it.
    await trigger.click();
    await expect(menu).toBeVisible();
    await page.getByRole("heading", { level: 1 }).click();
    await expect(menu).toHaveCount(0);

    // Signing out from it.
    await trigger.click();
    await menu.getByRole("menuitem", { name: "تسجيل الخروج" }).click();
    await page.waitForURL(/\/ar\/?$/);
    await expect(page.getByRole("button", { name: /^قائمة حساب/ })).toHaveCount(0);
  });

  test("a player who manages nothing sees only their own pages", async ({ page }) => {
    const user = await createAuthUser("Plain");
    await signIn(page, user);
    await page.getByRole("button", { name: `قائمة حساب ${user.name}` }).click();
    await expect(page.getByRole("menu").getByRole("menuitem")).toHaveText(["لوحتي", "ملفي الشخصي", "أصدقائي", "فرقي", "حجوزاتي", "الإعدادات", "تسجيل الخروج"]);
  });
});
