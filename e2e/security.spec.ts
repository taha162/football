import type { Page } from "@playwright/test";
import { createAuthUser, expect, rpc, signIn, test } from "./fixtures";

/** Collects what the Content-Security-Policy blocked on a page. */
async function watchPolicy(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __blocked: string[] };
    w.__blocked = [];
    document.addEventListener("securitypolicyviolation", (e) => w.__blocked.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  return () => page.evaluate(() => (window as unknown as { __blocked: string[] }).__blocked);
}

test.describe("Security headers", () => {
  test("every page carries the protective headers", async ({ request }) => {
    for (const path of ["/ar", "/ar/venues", "/ar/sign-in", "/api/health"]) {
      const res = await request.get(path);
      const h = res.headers();
      expect(h["content-security-policy"], path).toContain("frame-ancestors 'none'");
      expect(h["content-security-policy"], path).toContain("object-src 'none'");
      expect(h["content-security-policy"], path).toContain("base-uri 'self'");
      expect(h["content-security-policy"], path).toContain("form-action 'self'");
      expect(h["x-frame-options"], path).toBe("DENY");
      expect(h["x-content-type-options"], path).toBe("nosniff");
      expect(h["referrer-policy"], path).toBe("strict-origin-when-cross-origin");
      expect(h["strict-transport-security"], path).toContain("max-age=");
      expect(h["x-powered-by"], path).toBeUndefined();
    }
  });

  test("pages allow only scripts with this response's nonce, so injected script never runs", async ({ page, request }) => {
    const scriptPolicies: string[] = [];
    for (let i = 0; i < 2; i++) {
      const res = await request.get("/ar/sign-in");
      const policies = res.headersArray().filter((h) => h.name.toLowerCase() === "content-security-policy");
      // One policy (the page's own), not the general one as well.
      expect(policies).toHaveLength(1);
      const script = policies[0].value.split("; ").find((d) => d.startsWith("script-src "));
      expect(script).toMatch(/^script-src 'self' 'nonce-[A-Za-z0-9+/]{22}==' 'strict-dynamic'$/);
      scriptPolicies.push(script!);
    }
    // A fresh nonce for every response: one seen once can't be reused.
    expect(scriptPolicies[0]).not.toBe(scriptPolicies[1]);

    // Markup injected into the page (what an XSS bug would let through): its inline handler is refused.
    const blocked = await watchPolicy(page);
    await page.goto("/ar/sign-in");
    await page.waitForLoadState("networkidle");
    await page.evaluate(() => {
      document.body.insertAdjacentHTML("beforeend", '<img src="/missing-for-csp-check.png" onerror="window.__injected = 1">');
    });
    await expect.poll(blocked).toContainEqual(expect.stringMatching(/^script-src/));
    expect(await page.evaluate(() => (window as unknown as { __injected?: number }).__injected)).toBeUndefined();
  });

  test("the policy blocks nothing the site itself uses", async ({ page }) => {
    const blocked = await watchPolicy(page);
    const [me, friend] = [await createAuthUser("Me"), await createAuthUser("Friend")];
    const conv = await rpc<string>(me.id, "start_direct_conversation", { p_user_id: friend.id });
    // A location card shows a map tile from OpenStreetMap.
    await rpc(friend.id, "send_message", { p_conversation_id: conv, p_body: "", p_location_lat: 36.34, p_location_lng: 43.13, p_location_accuracy: 10 });

    // The landing page: its stadium, video and first-paint scripts.
    await page.goto("/ar");
    await page.waitForLoadState("networkidle");
    await signIn(page, me);
    for (const path of ["/ar/venues", "/ar/matches", "/ar/notifications", `/ar/messages/${conv}`]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
    }
    // Live updates connect (a message arrives while the conversation is open).
    await rpc(friend.id, "send_message", { p_conversation_id: conv, p_body: "live check" });
    await expect(page.getByText("live check")).toBeVisible({ timeout: 15_000 });
    expect(await blocked()).toEqual([]);
  });
});
