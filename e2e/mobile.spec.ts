import { randomUUID } from "node:crypto";
import { createAuthUser, createMatchFor, expect, signIn, test } from "./fixtures";

test.describe("Mobile (Arabic, RTL)", () => {
  test("a player signs in, finds and joins a match on a phone in Arabic", async ({ page }) => {
    const organizer = await createAuthUser("Organizer");
    const player = await createAuthUser("Player", { locale: "ar" });
    const title = `مباراة ${randomUUID().slice(0, 6)}`;
    const matchId = await createMatchFor(organizer, { p_title: title, p_total_cost: 50_000 });

    await signIn(page, player, "ar");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");

    // Bottom navigation is the primary navigation on small screens.
    const quickNav = page.getByRole("navigation", { name: "تنقل سريع" });
    await expect(quickNav).toBeVisible();
    await quickNav.getByRole("link", { name: "المباريات" }).click();
    await page.waitForURL(/\/ar\/matches/);
    await expect(page.getByRole("heading", { name: "ابحث عن مباراة" })).toBeVisible();

    // Filters are collapsed on small screens.
    await page.getByText("التصفية", { exact: true }).click();
    await page.getByPlaceholder("عنوان المباراة أو الملعب").fill(title);
    await page.getByPlaceholder("عنوان المباراة أو الملعب").press("Enter");
    await page.getByRole("link", { name: title }).click();
    await page.waitForURL(new RegExp(`/ar/matches/${matchId}`));

    await page.getByRole("button", { name: "انضم للمباراة" }).click();
    await expect(page.getByText("أنت مسجل", { exact: true })).toBeVisible();

    // No horizontal overflow on a phone-sized viewport.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("public pages fit the phone viewport in both languages", async ({ page }) => {
    for (const path of ["/ar", "/en", "/ar/matches", "/ar/venues", "/ar/teams", "/ar/tournaments", "/ar/sign-up"]) {
      await page.goto(path);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `horizontal overflow on ${path}`).toBeLessThanOrEqual(0);
    }
  });
});
