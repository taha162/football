import { randomUUID } from "node:crypto";
import { createAuthUser, createMatchFor, expect, mosul, rpc, signIn, test } from "./fixtures";

test.describe("Mobile (Arabic, RTL)", () => {
  test("a player signs in, finds and joins a match on a phone in Arabic", async ({ page }) => {
    const organizer = await createAuthUser("Organizer");
    const player = await createAuthUser("Player");
    const title = `مباراة ${randomUUID().slice(0, 6)}`;
    const matchId = await createMatchFor(organizer, { p_title: title, p_total_cost: 50_000 });

    await signIn(page, player);
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");

    // Bottom navigation is the primary navigation on small screens.
    const quickNav = page.getByRole("navigation", { name: "تنقل سريع" });
    await expect(quickNav).toBeVisible();
    await expect(quickNav.getByRole("link", { name: "الملاعب" })).toBeVisible();

    // The account menu keeps to the essentials: no venue or tournament pages for someone who manages neither.
    await page.getByLabel(`قائمة حساب ${player.name}`).click();
    const menu = page.locator("details[open] .menu-panel");
    await expect(menu.getByRole("link")).toHaveText(["لوحتي", "ملفي الشخصي", "فرقي", "حجوزاتي", "الإعدادات"]);
    await page.getByLabel(`قائمة حساب ${player.name}`).click();

    await quickNav.getByRole("link", { name: "المباريات" }).click();
    await page.waitForURL(/\/ar\/matches/);
    await expect(page.getByRole("heading", { name: "ابحث عن مباراة" })).toBeVisible();

    // Filters are collapsed on small screens.
    await page.getByText("التصفية", { exact: true }).click();
    await page.getByPlaceholder("عنوان المباراة أو الملعب").fill(title);
    await page.getByPlaceholder("عنوان المباراة أو الملعب").press("Enter");
    // The whole card opens the match (its title link sits under the card's click layer).
    await page.locator("article", { hasText: title }).click();
    await page.waitForURL(new RegExp(`/ar/matches/${matchId}`));

    await page.getByRole("button", { name: "انضم للمباراة" }).click();
    await expect(page.getByText("أنت مسجل", { exact: true })).toBeVisible();

    // No horizontal overflow on a phone-sized viewport.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("venues are searched by name only and shown two to a row", async ({ page }) => {
    const owner = await createAuthUser("Owner");
    const tag = randomUUID().slice(0, 6);
    for (const name of [`ملعب الندى ${tag}`, `ملعب الفجر ${tag}`, `ساحة الأمل ${tag}`]) {
      await rpc(owner.id, "create_venue", { p_name: name, p_city_id: await mosul() });
    }
    await page.goto("/ar/venues");
    // Only the name: no city, area, format or "bookable" filters.
    const search = page.getByRole("search");
    await expect(search.getByRole("searchbox", { name: "اسم الملعب" })).toBeVisible();
    await expect(search.getByRole("combobox")).toHaveCount(0);
    await expect(search.getByRole("checkbox")).toHaveCount(0);

    await search.getByRole("searchbox").fill(`ملعب ${tag}`);
    await search.getByRole("button", { name: "ابحث" }).click();
    await expect(page.getByText(`لا يوجد ملعب باسم «ملعب ${tag}»`)).toBeVisible();
    await search.getByRole("searchbox").fill(tag);
    await search.getByRole("button", { name: "ابحث" }).click();
    const cards = page.getByTestId("venue-grid").getByRole("article");
    await expect(cards).toHaveCount(3);

    // Two to a row: the first two side by side, the third below them. (Layout
    // positions, not on-screen boxes: the cards slide in as they appear.)
    const [a, b, c] = await cards.evaluateAll((els) =>
      (els as HTMLElement[]).map((e) => ({ x: e.offsetLeft, y: e.offsetTop, width: e.offsetWidth, height: e.offsetHeight })),
    );
    expect(a.y).toBe(b.y);
    expect(Math.abs(a.x - b.x)).toBeGreaterThan(a.width / 2);
    expect(a.width).toBeLessThan(page.viewportSize()!.width / 2);
    expect(c.y).toBeGreaterThanOrEqual(a.y + a.height);
  });

  test("public pages fit the phone viewport", async ({ page }) => {
    const screen = page.viewportSize()!.width;
    for (const path of ["/ar", "/ar/matches", "/ar/venues", "/ar/teams", "/ar/tournaments", "/ar/sign-up"]) {
      await page.goto(path);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `horizontal overflow on ${path}`).toBeLessThanOrEqual(0);
      // A phone widens its layout viewport to fit content that is too wide (on
      // right-to-left pages, content sticking out on the left too), which the
      // check above cannot see. The page must stay exactly as wide as the screen.
      expect(await page.evaluate(() => window.innerWidth), `layout wider than the screen on ${path}`).toBe(screen);
    }
  });

  test("the header fits tablet screens and carries the logo's line under the name", async ({ page }) => {
    // The fullest header: an administrator, signed in.
    const user = await createAuthUser("Tablet", { admin: true });
    await signIn(page, user);
    for (const width of [768, 820, 1024]) {
      await page.setViewportSize({ width, height: 1024 });
      await page.goto("/ar/matches");
      expect(await page.evaluate(() => window.innerWidth), `layout wider than ${width}px`).toBe(width);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(0);
    }
    // As on the logo: «الملعب» with «احنا الاسسنا الملعب واحنا النلعب بي» under it.
    await page.goto("/ar/matches");
    await expect(page.locator("header").getByRole("img", { name: /احنا الاسسنا الملعب واحنا النلعب بي/ })).toBeVisible();
  });
});
