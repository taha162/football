import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { createAuthUser, createMatchFor, expect, test } from "./fixtures";

/** Marked content currently held invisible, waiting to rise into view (src/components/motion/reveal.ts). */
const hiddenReveals = (page: Page) =>
  page.evaluate(() => [...document.querySelectorAll(".reveal, .reveal-children > *")].filter((el) => getComputedStyle(el).opacity === "0").length);

test.describe("Motion", () => {
  test("search filters update the list in place, without reloading the page", async ({ page }) => {
    await page.goto("/en/teams");
    await page.evaluate(() => ((window as unknown as { sameDocument: boolean }).sameDocument = true));
    const query = `nobody-${randomUUID().slice(0, 6)}`;
    await page.getByPlaceholder("Team name").fill(query);
    await page.getByRole("button", { name: "Apply" }).click();
    await page.waitForURL(new RegExp(`q=${query}`));
    await expect(page.getByText("No teams match your search.")).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { sameDocument?: boolean }).sameDocument)).toBe(true);
  });

  test("content below the fold rises into view and is never left hidden", async ({ page }) => {
    const organizer = await createAuthUser("Organizer");
    const tag = `Reveal ${randomUUID().slice(0, 6)}`;
    for (let i = 0; i < 5; i++) await createMatchFor(organizer, { p_title: `${tag} ${i}` });
    await page.setViewportSize({ width: 1280, height: 560 });
    await page.goto(`/en/matches?q=${encodeURIComponent(tag)}`);
    const cards = page.locator("article", { hasText: tag });
    await expect(cards).toHaveCount(5);
    // Below the fold, cards wait for their turn…
    await expect.poll(() => hiddenReveals(page)).toBeGreaterThan(0);
    // …and every one of them arrives once scrolled to.
    for (const card of await cards.all()) await card.scrollIntoViewIfNeeded();
    await expect.poll(() => hiddenReveals(page)).toBe(0);
  });

  test("with reduced motion nothing is held back", async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 1280, height: 560 } });
    const page = await context.newPage();
    await page.goto("/en/matches");
    await expect(page.locator("main h1")).toBeVisible();
    await page.waitForTimeout(500);
    expect(await hiddenReveals(page)).toBe(0);
    await context.close();
  });
});
