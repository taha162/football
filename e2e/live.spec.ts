import { createAuthUser, createMatchFor, expect, rpc, signIn, test } from "./fixtures";

test.describe("Live updates", () => {
  test("news for me shows up without reloading the page", async ({ page }) => {
    const [me, friend] = [await createAuthUser("Me"), await createAuthUser("Friend")];
    await signIn(page, me);
    await expect(page.getByRole("link", { name: "الإشعارات", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "الرسائل", exact: true })).toBeVisible();
    // Once the page really listens (Realtime: "Subscribed to PostgreSQL"; after a cold start that can take seconds).
    await expect(page.locator('html[data-live="on"]')).toHaveCount(1, { timeout: 15_000 });

    // A friend writes: the messages button gets a red dot, with no reload (screen readers hear how many).
    const conv = await rpc<string>(friend.id, "start_direct_conversation", { p_user_id: me.id });
    await rpc(friend.id, "send_message", { p_conversation_id: conv, p_body: "Game tonight?" });
    const messages = page.getByRole("link", { name: "الرسائل (1 غير مقروءة)" });
    await expect(messages).toBeVisible({ timeout: 15_000 });
    await expect(messages.getByTestId("unread-dot")).toBeVisible();
    // A message is never news for the bell: no count there, and not in the notifications list.
    await expect(page.getByRole("link", { name: "الإشعارات", exact: true })).toBeVisible();
    await page.goto("/ar/notifications");
    await expect(page.getByText("رسالة جديدة", { exact: false })).toHaveCount(0);
  });

  test("an open page catches up with changes that don't notify me", async ({ page }) => {
    test.setTimeout(90_000);
    const [organizer, viewer, joiner] = [await createAuthUser("Org"), await createAuthUser("Viewer"), await createAuthUser("Joiner")];
    const match = await createMatchFor(organizer, { p_total_players: 10 });
    await signIn(page, viewer);
    // The page's clock is ours to move: open pages check every 90 s (live.check_seconds, ±10%).
    await page.clock.install();
    await page.goto(`/ar/matches/${match}`);
    const roster = page.getByRole("heading", { name: /^اللاعبون/ });
    const before = (await roster.textContent())!;

    // Someone else joins: the viewer isn't notified. Nothing changes before the next check…
    await rpc(joiner.id, "join_match", { p_match_id: match });
    await page.clock.fastForward("00:30");
    await expect(roster).toHaveText(before);
    // …and the page shows it once the check comes round, without a reload.
    await page.clock.fastForward("01:15");
    await expect(roster).not.toHaveText(before, { timeout: 15_000 });
    await expect(page.getByText(joiner.name)).toBeVisible();
  });
});
