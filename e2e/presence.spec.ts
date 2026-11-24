import { admin, createAuthUser, expect, rpc, signIn, test } from "./fixtures";

const beat = async (id: string) => (await admin("select 1 from public.user_presence where user_id = $1", [id])).length;

/** «نشط الآن» and «نشط قبل…» (migration 0049). */
test.describe("Activity status", () => {
  test("someone one talks with shows as active now, then how long ago; strangers see nothing; hidden, nobody does", async ({ page, browser }) => {
    test.setTimeout(120_000);
    const [me, peer, stranger] = [await createAuthUser("Watcher"), await createAuthUser("Runner"), await createAuthUser("Passer-by")];
    const conv = await rpc<string>(peer.id, "start_direct_conversation", { p_user_id: me.id });

    // They open the site: it notes they're active.
    const theirs = await browser.newContext();
    const other = await theirs.newPage();
    await signIn(other, peer);
    await expect.poll(() => beat(peer.id)).toBe(1);

    // The list of conversations: a green dot on their picture; their conversation and their page say it.
    await signIn(page, me);
    await page.goto("/ar/messages");
    await expect(page.getByRole("listitem").filter({ hasText: peer.name }).getByTestId("online-dot")).toBeVisible();
    await page.goto(`/ar/messages/${conv}`);
    await expect(page.getByTestId("active-status")).toHaveText("نشط الآن");
    await page.goto(`/ar/players/${peer.id}`);
    await expect(page.getByTestId("active-status")).toHaveText("نشط الآن");

    // They leave; ten minutes on, it says how long ago.
    await theirs.close();
    await admin("update public.user_presence set last_seen_at = now() - interval '10 minutes' where user_id = $1", [peer.id]);
    await page.reload();
    await expect(page.getByTestId("active-status")).toHaveText("نشط قبل 10 دقائق");
    await page.goto(`/ar/messages/${conv}`);
    await expect(page.getByTestId("active-status")).toHaveText("نشط قبل 10 دقائق");
    await page.goto("/ar/messages");
    await expect(page.getByRole("listitem").filter({ hasText: peer.name })).toBeVisible();
    await expect(page.getByTestId("online-dot")).toHaveCount(0);

    // Someone they've never talked with sees nothing.
    const passer = await (await browser.newContext()).newPage();
    await signIn(passer, stranger);
    await passer.goto(`/ar/players/${peer.id}`);
    await expect(passer.getByRole("heading", { name: peer.name, level: 1 })).toBeVisible();
    await expect(passer.getByTestId("active-status")).toHaveCount(0);

    // They hide it in their settings: gone for everyone, the bar says what kind of conversation it is again.
    const back = await (await browser.newContext()).newPage();
    await signIn(back, peer);
    await back.goto("/ar/settings");
    const privacy = back.getByRole("region", { name: "الخصوصية" });
    const show = privacy.getByRole("checkbox", { name: "إظهار متى كنت نشطاً" });
    await expect(show).toBeChecked();
    await show.uncheck();
    await privacy.getByRole("button", { name: "حفظ الخصوصية" }).click();
    await expect(privacy.getByText("تم حفظ إعدادات الخصوصية.")).toBeVisible();
    await back.reload();
    await expect(back.getByRole("region", { name: "الخصوصية" }).getByRole("checkbox", { name: "إظهار متى كنت نشطاً" })).not.toBeChecked();

    await page.goto(`/ar/messages/${conv}`);
    await expect(page.getByRole("heading", { name: peer.name, level: 1 })).toBeVisible();
    await expect(page.getByTestId("active-status")).toHaveCount(0);
    await expect(page.getByText("مباشرة", { exact: true })).toBeVisible();
    await page.goto(`/ar/players/${peer.id}`);
    await expect(page.getByRole("heading", { name: peer.name, level: 1 })).toBeVisible();
    await expect(page.getByTestId("active-status")).toHaveCount(0);
  });

  test("an open conversation moves from «نشط الآن» to how long ago by itself", async ({ page }) => {
    const [me, peer] = [await createAuthUser("Reader"), await createAuthUser("Sprinter")];
    const conv = await rpc<string>(peer.id, "start_direct_conversation", { p_user_id: me.id });
    await admin("insert into public.user_presence (user_id, last_seen_at) values ($1, now() - interval '1 minute')", [peer.id]);
    await signIn(page, me);
    await page.clock.install();
    await page.goto(`/ar/messages/${conv}`);
    await expect(page.getByTestId("active-status")).toHaveText("نشط الآن");
    // Writing a reply (the page doesn't refresh meanwhile); two minutes on, it says how long ago by itself.
    await page.getByRole("textbox", { name: "اكتب رسالة" }).fill("قادم");
    await page.clock.fastForward("02:00");
    await expect(page.getByTestId("active-status")).toHaveText("نشط قبل 3 دقائق");
  });
});
