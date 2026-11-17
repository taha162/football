import type { Page } from "@playwright/test";
import { admin, createAuthUser, expect, rpc, signIn, test, testAddress } from "./fixtures";

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

test.describe("Security review (17 November 2026)", () => {
  test("session cookies are HttpOnly and SameSite: page scripts can't read them", async ({ page, context }) => {
    const user = await createAuthUser("Cookie");
    await signIn(page, user);
    const session = (await context.cookies()).filter((c) => c.name.startsWith("sb-"));
    expect(session.length).toBeGreaterThan(0);
    for (const c of session) {
      expect(c.httpOnly, c.name).toBe(true);
      expect(c.sameSite, c.name).toBe("Lax");
    }
    expect(await page.evaluate(() => document.cookie)).not.toContain("sb-");
  });

  test("/api/session gives the page a short-lived token, only to the site itself and only with a session", async ({ page, browser }) => {
    const user = await createAuthUser("Token");
    await signIn(page, user);
    const res = await page.request.get("/api/session");
    expect(res.status()).toBe(200);
    expect(res.headers()["cache-control"]).toContain("no-store");
    expect(res.headers()["access-control-allow-origin"]).toBeUndefined();
    const body = (await res.json()) as { access_token: unknown; expires_at: unknown; user_id: unknown };
    expect(typeof body.access_token).toBe("string");
    expect(body.user_id).toBe(user.id);
    expect(Object.keys(body).sort()).toEqual(["access_token", "expires_at", "user_id"]);
    // Asked from another site (the browser says so): refused.
    expect((await page.request.get("/api/session", { headers: { "sec-fetch-site": "cross-site" } })).status()).toBe(403);
    // Without a session: nothing.
    const visitor = await browser.newContext();
    expect((await visitor.request.get("/api/session")).status()).toBe(401);
    await visitor.close();
  });

  test("files that must never be served answer 404, under any prefix", async ({ request }) => {
    for (const path of ["/.env", "/.env.local", "/ar/.env", "/.git/config", "/ar/.git/HEAD", "/backup.sql", "/ar/dump.sql.gz", "/site.zip", "/server.log", "/package.json", "/supabase/config.toml", "/pnpm-lock.yaml"]) {
      const res = await request.get(path, { maxRedirects: 0 });
      expect(res.status(), path).toBe(404);
      expect(await res.text(), path).not.toMatch(/SUPABASE|SERVICE_ROLE|\[core\]|BEGIN/);
    }
  });

  test("admin pages open only for staff: visitors go to sign in, members and moderators are sent away", async ({ page, request, browser }) => {
    const target = await createAuthUser("Target");
    const pages = ["/ar/admin", "/ar/admin/users", "/ar/admin/audit", "/ar/admin/settings", "/ar/admin/promotions", "/ar/admin/reports", "/ar/admin/content", "/ar/admin/bookings", "/ar/admin/venues", `/ar/admin/users/${target.id}/delete`];
    for (const path of pages) {
      const res = await request.get(path, { maxRedirects: 0 });
      expect(res.status(), path).toBe(307);
      expect(res.headers().location, path).toMatch(/\/ar\/sign-in\?next=/);
    }
    await signIn(page, await createAuthUser("Member"));
    for (const path of pages) {
      await page.goto(path);
      await expect(page, path).not.toHaveURL(/\/admin/);
    }
    // A moderator has the moderation pages, but not the admins' own.
    const moderator = await createAuthUser("Moderator");
    await admin("insert into public.user_roles (user_id, role) values ($1, 'moderator')", [moderator.id]);
    const mod = await (await browser.newContext()).newPage();
    await signIn(mod, moderator);
    for (const path of ["/ar/admin/users", "/ar/admin/settings", "/ar/admin/promotions", `/ar/admin/users/${target.id}/delete`]) {
      await mod.goto(path);
      await expect(mod, path).toHaveURL(/\/ar\/admin$/);
    }
    await mod.context().close();
  });

  test("CSRF: a data-changing request from another site is refused by the server, even carrying the session", async ({ page }) => {
    const user = await createAuthUser("Csrf");
    await signIn(page, user);
    await page.goto("/ar/settings");
    const prefs = async () =>
      (await admin<{ p: Record<string, boolean> | null }>("select notification_prefs as p from public.user_preferences where user_id = $1", [user.id]))[0]?.p ?? {};

    // A real save from the page, captured as sent.
    const sent = page.waitForRequest((r) => r.method() === "POST" && Boolean(r.headers()["next-action"]));
    await page.locator('input[name="muted"][value="match_reminder"]').check();
    await page.getByRole("button", { name: "حفظ التفضيلات" }).click();
    const original = await sent;
    await expect(page.getByText("تم حفظ التفضيلات.")).toBeVisible();
    expect(await prefs()).toEqual({ match_reminder: false });

    const replay = async (origin: string) => {
      await admin("update public.user_preferences set notification_prefs = '{}'::jsonb where user_id = $1", [user.id]);
      const headers = Object.fromEntries(Object.entries(await original.allHeaders()).filter(([k]) => !["host", "content-length", "cookie"].includes(k)));
      return page.request.fetch(original.url(), { method: "POST", headers: { ...headers, origin }, data: original.postDataBuffer() ?? "" });
    };
    // From another site, with the session cookies attached (what SameSite=Lax already stops browsers from sending): refused, nothing saved.
    const forged = await replay("https://evil.example");
    expect(forged.status()).toBeGreaterThanOrEqual(400);
    expect(await prefs()).toEqual({});
    // The same request from the site itself still works: the origin is what was refused.
    expect((await replay(new URL(page.url()).origin)).ok()).toBe(true);
    expect(await prefs()).toEqual({ match_reminder: false });
  });

  test("CORS: another site's scripts get no access to the API", async ({ request }) => {
    const preflight = await request.fetch("/api/health", { method: "OPTIONS", headers: { origin: "https://evil.example", "access-control-request-method": "GET" } });
    expect(preflight.headers()["access-control-allow-origin"]).toBeUndefined();
    const get = await request.get("/api/health", { headers: { origin: "https://evil.example" } });
    expect(get.headers()["access-control-allow-origin"]).toBeUndefined();
  });

  test("an API route stops a flood from one address", async ({ request }) => {
    const from = { "x-real-ip": testAddress() };
    const codes: number[] = [];
    for (let i = 0; i < 60; i++) codes.push((await request.get("/api/health", { headers: from })).status());
    expect(codes.every((c) => c === 200)).toBe(true);
    const last = await request.get("/api/health", { headers: from });
    expect(last.status()).toBe(429);
    expect(Number(last.headers()["retry-after"])).toBeGreaterThan(0);
    // Another address is unaffected.
    expect((await request.get("/api/health", { headers: { "x-real-ip": testAddress() } })).status()).toBe(200);
  });
});
