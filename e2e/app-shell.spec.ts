import { expect, test } from "./fixtures";

/** The phone app (mobile/): the same site, laid out for it when the user agent says so. */
test.describe("Inside the phone app", () => {
  test.use({ userAgent: "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36 AlMalabApp/1" });

  test("the page runs edge to edge and its top bar keeps clear of the status bar", async ({ page }) => {
    await page.goto("/ar/sign-in");
    await expect(page.locator("html")).toHaveAttribute("data-app", "");
    await expect(page.locator('meta[name="viewport"]')).toHaveAttribute("content", /viewport-fit=cover/);
    // The rule that keeps the bars clear of the notch (the test browser has none, so it is read, not measured).
    const rule = await page.evaluate(() =>
      [...document.styleSheets].flatMap((sheet) => [...sheet.cssRules]).some((r) => r instanceof CSSStyleRule && r.selectorText.includes("html[data-app] .site-header") && r.style.paddingTop.includes("safe-area-inset-top")),
    );
    expect(rule).toBe(true);
  });
});

test.describe("In a browser", () => {
  test("nothing changes", async ({ page }) => {
    await page.goto("/ar/sign-in");
    await expect(page.locator("html")).not.toHaveAttribute("data-app");
    await expect(page.locator('meta[name="viewport"]')).not.toHaveAttribute("content", /viewport-fit/);
  });
});
