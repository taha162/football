import { randomUUID } from "node:crypto";
import { admin, createAuthUser, createMatchFor, expect, mosul, rpc, signIn, test } from "./fixtures";

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
    // Venues next to home, «+» books a pitch, then matches.
    await expect(quickNav.getByRole("link")).toHaveText(["الرئيسية", "الملاعب", "احجز ملعباً", "المباريات", "الرسائل"]);
    await quickNav.getByRole("link", { name: "احجز ملعباً" }).click();
    await page.waitForURL(/\/ar\/venues\?bookable=1/);
    await expect(page.getByRole("heading", { name: "احجز ملعباً" })).toBeVisible();

    // The account menu keeps to the essentials: no venue or tournament pages for someone who manages neither.
    const account = page.getByRole("button", { name: `قائمة حساب ${player.name}` });
    await account.click();
    const menu = page.getByRole("menu");
    await expect(menu.getByRole("menuitem")).toHaveText(["لوحتي", "ملفي الشخصي", "فرقي", "حجوزاتي", "الإعدادات", "تسجيل الخروج"]);
    // On a phone the menu stays on the screen.
    const box = (await menu.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    await account.click();
    await expect(menu).toHaveCount(0);

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

    // Booking («+» in the bottom bar): only venues taking bookings, each opening its booking page.
    // (Another owner: creating venues is limited per person per day.)
    const owner2 = await createAuthUser("Owner");
    const bookable = await rpc<string>(owner2.id, "create_venue", { p_name: `ملعب الحجز ${tag}`, p_city_id: await mosul() });
    await rpc(owner2.id, "upsert_venue_field", {
      p_venue_id: bookable, p_field_id: null, p_name: "ساحة 1", p_surface: "artificial_turf", p_formats: "{5v5}",
      p_is_covered: false, p_has_lights: true, p_price_per_hour: 30_000,
    });
    await admin("update public.venues set verification_status = 'verified' where id = $1", [bookable]);
    await rpc(owner2.id, "set_venue_deposit_instructions", { p_venue_id: bookable, p_instructions: "Cash at the desk" });
    await page.goto(`/ar/venues?bookable=1&q=${encodeURIComponent(tag)}`);
    await expect(page.getByRole("heading", { name: "احجز ملعباً" })).toBeVisible();
    await expect(cards).toHaveCount(1);
    await expect(cards.getByRole("link", { name: `ملعب الحجز ${tag}` })).toHaveAttribute("href", `/ar/venues/${bookable}/book`);
  });

  test("a new message is a red dot on the messages tab; a conversation fills the phone and its box stays above the keyboard", async ({ page }) => {
    const [me, friend] = [await createAuthUser("Phone chat"), await createAuthUser("Phone friend")];
    const conv = await rpc<string>(friend.id, "start_direct_conversation", { p_user_id: me.id });
    await rpc(friend.id, "send_message", { p_conversation_id: conv, p_body: "مرحبا، نلعب اليوم؟" });
    await signIn(page, me);
    const quickNav = page.getByRole("navigation", { name: "تنقل سريع" });
    const tab = quickNav.getByRole("link", { name: "الرسائل (1 غير مقروءة)" });
    await expect(tab.getByTestId("unread-dot")).toBeVisible();
    // Not news for the bell.
    await expect(page.getByRole("link", { name: "الإشعارات", exact: true })).toBeVisible();

    await tab.click();
    await page.waitForURL(/\/ar\/messages$/);
    await page.getByRole("link", { name: new RegExp(friend.name) }).click();
    await page.waitForURL(new RegExp(`/ar/messages/${conv}`));
    // Its own screen, the whole phone: no site header, no bottom bar.
    const screen = page.getByTestId("chat-screen");
    await expect(screen).toBeVisible();
    await expect(quickNav).toHaveCount(0);
    await expect(page.locator("header.site-header")).toHaveCount(0);
    const height = page.viewportSize()!.height;
    expect((await screen.boundingBox())!.height).toBeCloseTo(height, 0);

    // The keyboard: the visible part of the page shrinks. The screen follows, so the box to write in stays in view.
    const write = page.getByRole("textbox", { name: "اكتب رسالة" });
    await write.focus();
    const { width } = page.viewportSize()!;
    await page.setViewportSize({ width, height: 400 });
    await expect.poll(async () => Math.round((await screen.boundingBox())!.height)).toBe(400);
    const box = (await write.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(400);
    expect(box.y).toBeGreaterThan(0);
    // The newest message stays in view above it.
    await expect(page.getByText("مرحبا، نلعب اليوم؟")).toBeInViewport();
    await page.setViewportSize({ width, height });

    // Back: the bottom bar is there again, and the message has been read.
    await page.getByRole("link", { name: "رجوع" }).click();
    await page.waitForURL(/\/ar\/messages$/);
    await expect(quickNav.getByRole("link", { name: "الرسائل", exact: true })).toBeVisible();
    await expect(quickNav.getByTestId("unread-dot")).toHaveCount(0);
  });

  test("a long press on a conversation opens its menu, not the conversation; a tap still opens it", async ({ page }) => {
    const [me, friend] = [await createAuthUser("Hold me"), await createAuthUser("Hold friend")];
    const conv = await rpc<string>(friend.id, "start_direct_conversation", { p_user_id: me.id });
    await rpc(friend.id, "send_message", { p_conversation_id: conv, p_body: "اضغط مطولاً" });
    await signIn(page, me);
    await page.goto("/ar/messages");
    // The press is read by the page's script: press once the page is interactive.
    await page.waitForLoadState("networkidle");
    const row = page.locator("li", { hasText: friend.name });
    // No «⌄» to see on a phone: it is there for screen readers only (one pixel).
    expect((await row.getByRole("button", { name: `خيارات محادثة ${friend.name}` }).boundingBox())?.width ?? 0).toBeLessThanOrEqual(1);
    const box = (await row.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(800);
    await page.mouse.up();
    const menu = page.getByRole("dialog", { name: friend.name });
    await expect(menu).toBeVisible();
    await expect(page).toHaveURL(/\/ar\/messages$/);
    await menu.getByRole("button", { name: "تثبيت المحادثة" }).click();
    await expect(row.getByText("مثبّتة")).toBeAttached();
    // A quick tap still opens the conversation.
    await row.getByRole("link").click();
    await page.waitForURL(new RegExp(`/ar/messages/${conv}`));
  });

  test("a member's pages fit the narrowest phone (320 px), even with long unbroken words", async ({ page }) => {
    const me = await createAuthUser("Narrow");
    const friend = await createAuthUser("Narrow friend");
    // No space to break at: such a title used to widen the whole page by its overflow.
    await createMatchFor(me, { p_title: `Journey${"1".repeat(24)}` });
    const conv = await rpc<string>(friend.id, "start_direct_conversation", { p_user_id: me.id });
    await rpc(friend.id, "send_message", { p_conversation_id: conv, p_body: `https://example.com/${"a".repeat(80)}` });
    await page.setViewportSize({ width: 320, height: 640 });
    await signIn(page, me);
    for (const path of ["/ar/dashboard", "/ar/matches", "/ar/my/matches", "/ar/messages", `/ar/messages/${conv}`, "/ar/notifications", "/ar/profile", "/ar/settings", "/ar/matches/new", "/ar/teams/new", "/ar/venues", "/ar/tournaments"]) {
      await page.goto(path);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `horizontal overflow on ${path}`).toBeLessThanOrEqual(0);
      expect(await page.evaluate(() => window.innerWidth), `layout wider than the screen on ${path}`).toBe(320);
    }
    // The conversation's box to write in: room for the words, and phones don't zoom into it (16 px).
    await page.goto(`/ar/messages/${conv}`);
    const write = page.getByRole("textbox", { name: "اكتب رسالة" });
    expect((await write.boundingBox())!.width).toBeGreaterThan(120);
    expect(await write.evaluate((el) => getComputedStyle(el).fontSize)).toBe("16px");
  });

  test("public pages fit the phone viewport", async ({ page }) => {
    const screen = page.viewportSize()!.width;
    for (const path of ["/ar", "/ar/matches", "/ar/venues", "/ar/teams", "/ar/tournaments", "/ar/sign-in", "/ar/sign-up"]) {
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
