import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { createAuthUser, createMatchFor, expect, test } from "./fixtures";

/** Marked content currently held invisible, waiting to rise into view (src/components/motion/reveal.ts). */
const hiddenReveals = (page: Page) =>
  page.evaluate(() => [...document.querySelectorAll(".reveal, .reveal-children > *")].filter((el) => getComputedStyle(el).opacity === "0").length);

test.describe("Motion", () => {
  test("search filters update the list in place, without reloading the page", async ({ page }) => {
    await page.goto("/ar/teams");
    await page.evaluate(() => ((window as unknown as { sameDocument: boolean }).sameDocument = true));
    const query = `nobody-${randomUUID().slice(0, 6)}`;
    await page.getByPlaceholder("اسم الفريق").fill(query);
    await page.getByRole("button", { name: "تطبيق" }).click();
    await page.waitForURL(new RegExp(`q=${query}`));
    await expect(page.getByText("لا توجد فرق مطابقة لبحثك.")).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { sameDocument?: boolean }).sameDocument)).toBe(true);
  });

  test("on a full page load, what is on screen rises into place, streamed sections included", async ({ page }) => {
    // Records every element that rises (enter-script.ts and reveal.ts share the frames).
    await page.addInitScript(() => {
      const risen: Element[] = ((window as unknown as { risen: Element[] }).risen = []);
      const animate = Element.prototype.animate;
      Element.prototype.animate = function (this: Element, frames: Keyframe[] | PropertyIndexedKeyframes | null, options?: number | KeyframeAnimationOptions) {
        if (Array.isArray(frames) && String(frames[0]?.transform ?? "").startsWith("translate3d")) risen.push(this);
        return animate.call(this, frames, options);
      };
    });
    // The page streams in behind the layout's stand-in, after the document itself has loaded.
    await page.goto("/ar/teams");
    await expect(page.locator("main h1")).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { risen: Element[] }).risen.includes(document.querySelector("main h1")!)))
      .toBe(true);
    // Once it has arrived, nothing on screen is left faded out.
    const fadedOnScreen = () =>
      page.evaluate(() =>
        [...document.querySelectorAll(".reveal, .reveal-children > *")].filter((el) => {
          const r = el.getBoundingClientRect();
          // The bottom 6% is where scroll reveals begin (reveal.ts).
          return (r.width || r.height) && r.bottom > 0 && r.top < innerHeight * 0.94 && getComputedStyle(el).opacity !== "1";
        }).length,
      );
    await expect.poll(fadedOnScreen).toBe(0);
  });

  test("content below the fold rises into view and is never left hidden", async ({ page }) => {
    const organizer = await createAuthUser("Organizer");
    const tag = `Reveal ${randomUUID().slice(0, 6)}`;
    for (let i = 0; i < 5; i++) await createMatchFor(organizer, { p_title: `${tag} ${i}` });
    await page.setViewportSize({ width: 1280, height: 560 });
    await page.goto(`/ar/matches?q=${encodeURIComponent(tag)}`);
    const cards = page.locator("article", { hasText: tag });
    await expect(cards).toHaveCount(5);
    const fadedCards = () => cards.evaluateAll((els) => els.filter((el) => getComputedStyle(el).opacity === "0").length);
    // Below the fold, cards wait for their turn…
    await expect.poll(fadedCards).toBeGreaterThan(0);
    // …and every one of them arrives once scrolled to.
    for (const card of await cards.all()) await card.scrollIntoViewIfNeeded();
    await expect.poll(fadedCards).toBe(0);
  });

  test("a quick move between pages shows no skeleton: the current page stays up until the next one is in", async ({ page }) => {
    await page.goto("/ar/venues");
    await page.goto("/ar/teams");
    await page.waitForLoadState("networkidle");
    // Every frame for three seconds from the tap: is a skeleton showing, is there a page in <main>?
    await page.evaluate(() => {
      const w = window as unknown as { frames: [number, boolean, boolean][] };
      const t0 = performance.now();
      w.frames = [];
      const tick = () => {
        const t = performance.now() - t0;
        const skeleton = [...document.querySelectorAll(".skeleton")].some((el) => el.checkVisibility({ opacityProperty: true, visibilityProperty: true }));
        const shown = Boolean(document.querySelector("main h1")?.checkVisibility({ visibilityProperty: true }));
        w.frames.push([t, skeleton, shown]);
        if (t < 3000) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await page.getByRole("navigation", { name: "التنقل الرئيسي" }).getByRole("link", { name: "الملاعب" }).click();
    await expect(page.locator("main h1")).toHaveText("الملاعب");
    await page.waitForTimeout(1500);
    const frames = await page.evaluate(() => (window as unknown as { frames: [number, boolean, boolean][] }).frames);
    // In the first second there is always a page on screen (the old one, then the new), and never a skeleton.
    const firstSecond = frames.filter(([t]) => t < 1000);
    expect(firstSecond.length).toBeGreaterThan(10);
    expect(firstSecond.filter(([, skeleton]) => skeleton)).toEqual([]);
    expect(firstSecond.filter(([, , shown]) => !shown)).toEqual([]);
  });

  test("a page that takes over a second gets its skeleton, and only then", async ({ page }) => {
    await page.goto("/ar/teams");
    await page.waitForLoadState("networkidle");
    // The venues page's data is held back 2.5 s (prefetches pass).
    await page.route(
      (url) => url.pathname === "/ar/venues" && url.searchParams.has("_rsc"),
      async (route) => {
        if (!route.request().headers()["next-router-prefetch"]) await new Promise((r) => setTimeout(r, 2500));
        await route.continue();
      },
    );
    const skeleton = page.locator(".nav-skeleton");
    const tapped = Date.now();
    await page.getByRole("navigation", { name: "التنقل الرئيسي" }).getByRole("link", { name: "الملاعب" }).click();
    // Half a second in: still the page the visitor was on.
    await page.waitForTimeout(500);
    await expect(skeleton).toBeHidden();
    await expect(page.locator("main h1")).toHaveText("الفرق");
    // Past a second: the skeleton, the page announced as loading.
    await expect(skeleton).toBeVisible();
    expect(Date.now() - tapped).toBeGreaterThanOrEqual(1000);
    await expect(page.locator("#main")).toHaveAttribute("aria-busy", "true");
    await expect(page.getByRole("status").filter({ hasText: "جارٍ التحميل…" })).toHaveCount(1);
    // Then the page, and nothing of the skeleton left.
    await expect(page.locator("main h1")).toHaveText("الملاعب");
    await expect(skeleton).toBeHidden();
    await expect(page.locator("#main")).not.toHaveAttribute("aria-busy");
    await expect(page.getByRole("status").filter({ hasText: "جارٍ التحميل…" })).toHaveCount(0);
  });

  test("with reduced motion nothing is held back", async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 1280, height: 560 } });
    const page = await context.newPage();
    await page.goto("/ar/matches");
    await expect(page.locator("main h1")).toBeVisible();
    await page.waitForTimeout(500);
    expect(await hiddenReveals(page)).toBe(0);
    await context.close();
  });
});
