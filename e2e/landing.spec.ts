import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { createAuthUser, expect, mosul, rpc, test } from "./fixtures";

/** Marks the opening as already seen in this tab, so a test lands straight on the hero. */
const skipOpening = (page: Page) => page.addInitScript(() => sessionStorage.setItem("malaab-intro-seen", "1"));
/**
 * A browser without WebGL. The scenes' content is server-rendered either way;
 * tests about content use this so software rendering on a busy test machine
 * cannot stall them.
 */
const withoutWebGL = (page: Page) =>
  page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      if (/webgl/i.test(type)) return null;
      return (getContext as (...a: unknown[]) => RenderingContext | null).call(this, type, ...rest);
    } as typeof getContext;
  });
const stageState = (page: Page) => page.evaluate(() => document.documentElement.dataset.stage ?? "");

test.describe("Landing stage", () => {
  test("tells its story in six scenes, each with working actions", async ({ page }) => {
    await withoutWebGL(page);
    await page.goto("/en");
    await expect(page.locator("[data-scene]")).toHaveCount(6);
    await expect(page.getByRole("heading", { level: 1, name: "Your next game starts here." })).toBeVisible();
    await expect(page.getByRole("link", { name: "Find a match" }).first()).toHaveAttribute("href", "/en/matches");
    await expect(page.getByRole("link", { name: "Book a pitch" })).toHaveAttribute("href", "/en/venues?bookable=1");
    for (const title of [
      "Matches looking for players.",
      "Build your squad, position by position.",
      "Find your pitch.",
      "When the lights stay on longer.",
      "The pitch is waiting.",
    ]) {
      await expect(page.getByRole("heading", { level: 2, name: title })).toBeAttached();
    }
    for (const position of ["goalkeeper", "defender", "midfielder", "forward"]) {
      await expect(page.locator(`a[data-position="${position}"]`)).toHaveAttribute("href", `/en/recruitment?position=${position}`);
    }
    // Every match on the board links to its own page, where the real join flow lives.
    for (const href of await page.locator('[data-scene="matches"] a.board-stretch').evaluateAll((els) => els.map((e) => e.getAttribute("href")))) {
      expect(href).toMatch(/^\/en\/matches\/[0-9a-f-]{36}$/);
    }
    await page.getByRole("link", { name: "Find your next match" }).click();
    await page.waitForURL(/\/en\/matches$/);
  });

  test("recruitment figures on the pitch come from the database", async ({ page }) => {
    await withoutWebGL(page);
    const row = () => page.locator('a[data-position="defender"]');
    const count = async () => {
      const text = (await row().innerText()).replace(/\s+/g, " ");
      const m = text.match(/(\d+) teams? looking/);
      return m ? Number(m[1]) : 0;
    };
    await page.goto("/en");
    const before = await count();

    const captain = await createAuthUser("Captain");
    const team = await rpc<string>(captain.id, "create_team", { p_name: `Stage FC ${randomUUID().slice(0, 5)}`, p_city_id: await mosul() });
    const title = `Centre-back ${randomUUID().slice(0, 6)}`;
    await rpc(captain.id, "create_recruitment", { p_team_id: team, p_title: title, p_positions: "{defender}" });

    await page.reload();
    await expect.poll(count).toBe(before + 1);
    await row().click();
    await page.waitForURL(/\/en\/recruitment\?position=defender/);
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
  });

  test("without WebGL it shows a still image and stays fully usable", async ({ page }) => {
    await withoutWebGL(page);
    await page.goto("/en");
    await expect(page.locator("html")).toHaveAttribute("data-stage", "fallback");
    await expect(page.locator("html")).toHaveAttribute("data-intro", "done");
    await expect(page.locator(".stage-fallback")).toBeVisible();
    await expect(page.getByRole("group", { name: "Scene controls" }).getByRole("button")).toHaveCount(0);
    await page.getByRole("link", { name: "Find a match" }).first().click();
    await page.waitForURL(/\/en\/matches/);
  });

  test("with reduced motion there is no opening and ambient motion starts paused", async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: "reduce" });
    const page = await context.newPage();
    await page.goto("/en");
    await expect(page.locator("html")).toHaveAttribute("data-intro", "done");
    await expect(page.getByRole("heading", { level: 1, name: "Your next game starts here." })).toBeVisible();
    await expect.poll(() => stageState(page), { timeout: 60_000 }).toMatch(/^(live|fallback)$/);
    if ((await stageState(page)) === "live") {
      await expect(page.getByRole("button", { name: "Play animation" })).toHaveAttribute("aria-pressed", "true");
    }
    await expect(page.getByRole("button", { name: "Skip intro" })).toHaveCount(0);
    await context.close();
  });

  test("the opening never holds the page, and can be skipped", async ({ page }) => {
    await page.goto("/en");
    const intro = () => page.evaluate(() => document.documentElement.dataset.intro ?? "");
    // The failsafe (3.5 s) releases the page whatever the engine is doing; allow for a busy test machine.
    await expect.poll(intro, { timeout: 15_000 }).not.toBe("wait");
    const skip = page.getByRole("button", { name: "Skip intro" });
    if ((await intro()) !== "done") {
      // On a slow (software-rendered) browser the opening may also end by itself meanwhile.
      await skip.click({ timeout: 3_000 }).catch(() => undefined);
    }
    await expect(page.locator("html")).toHaveAttribute("data-intro", "done", { timeout: 15_000 });
    await expect(skip).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Find a match" }).first()).toBeVisible();
    await expect(page.locator(".scene-hero .stage-panel.intro-reveal")).toHaveCSS("opacity", "1");
  });

  test("the ball can be kicked from the keyboard and brought back", async ({ page }) => {
    await skipOpening(page);
    await page.goto("/en");
    await expect.poll(() => stageState(page), { timeout: 60_000 }).toMatch(/^(live|fallback)$/);
    test.skip((await stageState(page)) !== "live", "WebGL is not available in this browser");

    const ball = page.getByRole("button", { name: "Kick the ball" });
    await expect(ball).toHaveAttribute("data-on", "true", { timeout: 30_000 });
    await ball.focus();
    await page.keyboard.press("Enter");
    const back = page.getByRole("button", { name: "Bring the ball back to the centre spot" });
    await expect(back).toBeVisible({ timeout: 30_000 });
    // The ball is rolled back with the pace to stop on the spot (it also comes back by itself after a while).
    if (await back.isVisible()) await back.click();
    await expect(back).toHaveCount(0, { timeout: 90_000 });
  });
});
