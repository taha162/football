import { createAuthUser, createMatchFor, emailedCode, expect, signIn, test } from "./fixtures";

test.describe("Journey A — register, onboard, discover and join", () => {
  test("a new user registers, completes onboarding, finds a match and joins it", async ({ page }) => {
    const organizer = await createAuthUser("Organizer");
    const title = `Journey A ${Date.now()}`;
    const matchId = await createMatchFor(organizer, { p_title: title });

    const email = `e2e-a-${Date.now()}@example.test`;
    await page.goto("/en/sign-up");
    await page.getByLabel("Display name").fill("Journey Player");
    await page.getByRole("textbox", { name: "Email" }).fill(email);
    await page.getByRole("textbox", { name: "Password" }).fill("Str0ng-pass-123");
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Create account" }).click();

    // E-mail confirmation is on: enter the code that was e-mailed.
    await page.waitForURL(/\/en\/verify-email/);
    await expect(page.getByText(email)).toBeVisible();
    await page.getByRole("textbox", { name: "Verification code" }).fill("000000");
    await page.getByRole("button", { name: "Verify" }).click();
    await expect(page.getByText("The code is wrong or has expired.")).toBeVisible();
    await page.getByRole("textbox", { name: "Verification code" }).fill(await emailedCode(email));
    await page.getByRole("button", { name: "Verify" }).click();
    await page.waitForURL(/\/en\/onboarding/);
    await expect(page.getByRole("heading", { name: "Set up your player profile" })).toBeVisible();
    await page.getByText("Goalkeeper", { exact: true }).click();
    await page.getByText("Intermediate", { exact: true }).click();
    await page.getByRole("button", { name: "Start playing" }).click();
    await page.waitForURL(/\/en\/dashboard/);

    // Discover via server-side filtered search.
    await page.goto(`/en/matches?open=1&format=5v5&q=${encodeURIComponent(title)}`);
    await page.getByRole("link", { name: title }).click();
    await page.waitForURL(new RegExp(`/en/matches/${matchId}`));
    await page.getByRole("button", { name: "Join match" }).click();
    await expect(page.getByText("You're in", { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText("You're in", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Leave match" })).toBeVisible();

    // Confirmation also appears as a notification.
    await page.goto("/en/notifications");
    await expect(page.getByText(new RegExp(`You're registered for ${title}`))).toBeVisible();
  });
});

test.describe("Journey C — waiting list promotion", () => {
  test("a player leaves a full match and the waiting player is promoted", async ({ browser }) => {
    const organizer = await createAuthUser("Org");
    const leaver = await createAuthUser("Leaver");
    const waiter = await createAuthUser("Waiter");
    const matchId = await createMatchFor(organizer, { p_total_players: 2, p_reserved_spots: 1 });

    const leaverCtx = await browser.newContext();
    const leaverPage = await leaverCtx.newPage();
    await signIn(leaverPage, leaver);
    await leaverPage.goto(`/en/matches/${matchId}`);
    await leaverPage.getByRole("button", { name: "Join match" }).click();
    await expect(leaverPage.getByText("You're in", { exact: true })).toBeVisible();

    const waiterCtx = await browser.newContext();
    const waiterPage = await waiterCtx.newPage();
    await signIn(waiterPage, waiter);
    await waiterPage.goto(`/en/matches/${matchId}`);
    await waiterPage.getByRole("button", { name: "Join waiting list" }).click();
    await expect(waiterPage.getByText("You're #1 on the waiting list")).toBeVisible();

    await leaverPage.reload();
    await leaverPage.getByRole("button", { name: "Leave match" }).click();
    const dialog = leaverPage.getByRole("dialog", { name: "Leave this match?" });
    await dialog.getByRole("button", { name: "Leave" }).click();
    // The freed spot went straight to the waiting player, so the match is full again.
    await expect(leaverPage.getByRole("button", { name: "Join waiting list" })).toBeVisible();

    await waiterPage.reload();
    await expect(waiterPage.getByText("You're in", { exact: true })).toBeVisible();
    await waiterPage.goto("/en/notifications");
    await expect(waiterPage.getByText(/A spot opened up/)).toBeVisible();
    await leaverCtx.close();
    await waiterCtx.close();
  });
});

test.describe("Journey J — Arabic and English", () => {
  test("switching language flips direction and translates the interface", async ({ page }) => {
    await page.goto("/ar");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.locator("html")).toHaveAttribute("lang", "ar");
    await expect(page.getByRole("link", { name: "ابحث عن مباراة" }).first()).toBeVisible();

    await page.getByRole("link", { name: "تغيير اللغة" }).click();
    await page.waitForURL(/\/en$/);
    await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
    await expect(page.getByRole("link", { name: "Find a match" }).first()).toBeVisible();

    // The choice persists (cookie) when visiting the root.
    await page.goto("/");
    await expect(page).toHaveURL(/\/en$/);

    await page.goto("/ar/matches");
    await expect(page.getByRole("heading", { name: "ابحث عن مباراة" })).toBeVisible();
    await page.goto("/ar/sign-in");
    await page.getByRole("button", { name: "تسجيل الدخول" }).click();
    // Native validation keeps the form from submitting empty; field stays focused & labelled in Arabic.
    await expect(page.getByLabel("البريد الإلكتروني")).toBeVisible();
  });
});

test.describe("Journey K — unauthorized access", () => {
  test("signed-out visitors are redirected away from private pages", async ({ page }) => {
    for (const path of ["/en/dashboard", "/en/admin", "/en/manage/venues", "/en/messages", "/en/matches/new"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/en\/sign-in\?next=/);
    }
  });

  test("players cannot open admin or another organizer's tools", async ({ page }) => {
    const organizer = await createAuthUser("Org");
    const player = await createAuthUser("Player");
    const matchId = await createMatchFor(organizer);
    await signIn(page, player);
    await page.goto("/en/admin");
    await expect(page).toHaveURL(/\/en\/dashboard/);
    await page.goto(`/en/matches/${matchId}/edit`);
    await expect(page).toHaveURL(new RegExp(`/en/matches/${matchId}$`));
    await expect(page.getByRole("heading", { name: "Organizer tools" })).toHaveCount(0);
  });

  test("the public API rejects direct writes and private reads with the anon key", async ({ request }) => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
    const anon =
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
    const headers = { apikey: anon, Authorization: `Bearer ${anon}`, "Content-Type": "application/json" };
    const insert = await request.post(`${url}/rest/v1/user_roles`, { headers, data: { user_id: "00000000-0000-0000-0000-000000000000", role: "admin" } });
    expect([401, 403]).toContain(insert.status());
    const notifications = await request.get(`${url}/rest/v1/notifications?select=*`, { headers });
    expect(await notifications.json()).toEqual([]);
    const join = await request.post(`${url}/rest/v1/rpc/join_match`, { headers, data: { p_match_id: "00000000-0000-0000-0000-000000000000" } });
    expect([401, 403]).toContain(join.status());
  });
});
