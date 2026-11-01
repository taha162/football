import { createAuthUser, createMatchFor, emailedCode, expect, signIn, test } from "./fixtures";

test.describe("Journey A — register, onboard, discover and join", () => {
  test("a new user registers, completes onboarding, finds a match and joins it", async ({ page }) => {
    const organizer = await createAuthUser("Organizer");
    const title = `Journey A ${Date.now()}`;
    const matchId = await createMatchFor(organizer, { p_title: title });

    const email = `e2e-a-${Date.now()}@example.test`;
    await page.goto("/ar/sign-up");
    await page.getByLabel("الاسم الظاهر").fill("Journey Player");
    await page.getByRole("textbox", { name: "البريد الإلكتروني" }).fill(email);
    await page.getByRole("textbox", { name: "كلمة المرور" }).fill("Str0ng-pass-123");
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "إنشاء حساب" }).click();

    // E-mail confirmation is on: enter the code that was e-mailed.
    await page.waitForURL(/\/ar\/verify-email/);
    await expect(page.getByText(email)).toBeVisible();
    await page.getByRole("textbox", { name: "رمز التحقق" }).fill("000000");
    await page.getByRole("button", { name: "تأكيد" }).click();
    await expect(page.getByText("الرمز غير صحيح أو انتهت صلاحيته.")).toBeVisible();
    await page.getByRole("textbox", { name: "رمز التحقق" }).fill(await emailedCode(email));
    await page.getByRole("button", { name: "تأكيد" }).click();
    await page.waitForURL(/\/ar\/onboarding/);
    await expect(page.getByRole("heading", { name: "جهّز ملفك كلاعب" })).toBeVisible();
    await page.getByText("حارس مرمى", { exact: true }).click();
    await page.getByText("متوسط", { exact: true }).click();
    await page.getByRole("button", { name: "ابدأ اللعب" }).click();
    await page.waitForURL(/\/ar\/dashboard/);

    // Discover via server-side filtered search.
    await page.goto(`/ar/matches?open=1&format=5v5&q=${encodeURIComponent(title)}`);
    // The whole card opens the match (its title link sits under the card's click layer).
    await page.locator("article", { hasText: title }).click();
    await page.waitForURL(new RegExp(`/ar/matches/${matchId}`));
    await page.getByRole("button", { name: "انضم للمباراة" }).click();
    await expect(page.getByText("أنت مسجل", { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText("أنت مسجل", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "مغادرة المباراة" })).toBeVisible();

    // Confirmation also appears as a notification.
    await page.goto("/ar/notifications");
    await expect(page.getByText(new RegExp(`تم تسجيلك في ${title}`))).toBeVisible();
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
    await leaverPage.goto(`/ar/matches/${matchId}`);
    await leaverPage.getByRole("button", { name: "انضم للمباراة" }).click();
    await expect(leaverPage.getByText("أنت مسجل", { exact: true })).toBeVisible();

    const waiterCtx = await browser.newContext();
    const waiterPage = await waiterCtx.newPage();
    await signIn(waiterPage, waiter);
    await waiterPage.goto(`/ar/matches/${matchId}`);
    await waiterPage.getByRole("button", { name: "انضم لقائمة الانتظار" }).click();
    await expect(waiterPage.getByText("ترتيبك 1 في قائمة الانتظار")).toBeVisible();

    await leaverPage.reload();
    await leaverPage.getByRole("button", { name: "مغادرة المباراة" }).click();
    const dialog = leaverPage.getByRole("dialog", { name: "مغادرة هذه المباراة؟" });
    await dialog.getByRole("button", { name: "مغادرة" }).click();
    // The freed spot went straight to the waiting player, so the match is full again.
    await expect(leaverPage.getByRole("button", { name: "انضم لقائمة الانتظار" })).toBeVisible();

    await waiterPage.reload();
    await expect(waiterPage.getByText("أنت مسجل", { exact: true })).toBeVisible();
    await waiterPage.goto("/ar/notifications");
    await expect(waiterPage.getByText(/توفر مكان/)).toBeVisible();
    await leaverCtx.close();
    await waiterCtx.close();
  });
});

test.describe("Journey J — Arabic only", () => {
  test("a first visit opens in Arabic even when the browser prefers English", async ({ page }) => {
    // The test browser sends Accept-Language: en-GB (playwright.config.ts).
    await page.goto("/");
    await expect(page).toHaveURL(/\/ar$/);
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  });

  test("old English links open the same page in Arabic, and there is no language switch", async ({ page }) => {
    await page.goto("/en/matches");
    await expect(page).toHaveURL(/\/ar\/matches$/);
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.locator("html")).toHaveAttribute("lang", "ar");
    await expect(page.getByRole("link", { name: "تغيير اللغة" })).toHaveCount(0);
    await page.goto("/en");
    await expect(page).toHaveURL(/\/ar$/);

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
    for (const path of ["/ar/dashboard", "/ar/admin", "/ar/manage/venues", "/ar/messages", "/ar/matches/new"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/ar\/sign-in\?next=/);
    }
  });

  test("players cannot open admin or another organizer's tools", async ({ page }) => {
    const organizer = await createAuthUser("Org");
    const player = await createAuthUser("Player");
    const matchId = await createMatchFor(organizer);
    await signIn(page, player);
    await page.goto("/ar/admin");
    await expect(page).toHaveURL(/\/ar\/dashboard/);
    await page.goto(`/ar/matches/${matchId}/edit`);
    await expect(page).toHaveURL(new RegExp(`/ar/matches/${matchId}$`));
    await expect(page.getByRole("heading", { name: "أدوات المنظم" })).toHaveCount(0);
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
