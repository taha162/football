import { createAuthUser, createMatchFor, expect, rpc, signIn, test } from "./fixtures";

test.describe("Faces on match cards", () => {
  test("signed in, a card shows the first players' faces and +N; a visitor sees the count alone", async ({ page }) => {
    const organizer = await createAuthUser("Faces organizer");
    const title = `Faces ${Date.now()}`;
    const matchId = await createMatchFor(organizer, { p_title: title });
    // Six players, one after another: the card shows the first four, then +2.
    const players = [];
    for (let i = 1; i <= 6; i++) {
      const p = await createAuthUser(`Face ${i}`);
      await rpc(p.id, "join_match", { p_match_id: matchId });
      players.push(p);
    }

    await signIn(page, await createAuthUser("Faces viewer"));
    await page.goto(`/ar/matches?q=${encodeURIComponent(title)}`);
    const card = page.locator("article", { hasText: title });
    const group = card.getByTestId("avatar-group");
    await expect(group).toBeVisible();
    await expect(group.locator("[title]")).toHaveCount(4);
    await expect(group.locator("[title]").first()).toHaveAttribute("title", players[0].name);
    await expect(group).toContainText("+2");
    // One picture for screen readers, saying who is in it.
    const label = (await group.getAttribute("aria-label"))!;
    expect(label.startsWith("في المباراة: ")).toBe(true);
    for (const p of players.slice(0, 4)) expect(label).toContain(p.name);
    expect(label).toContain("لاعبان آخران");

    // A visitor can't see rosters: no faces, the count as before.
    await page.context().clearCookies();
    await page.goto(`/ar/matches?q=${encodeURIComponent(title)}`);
    await expect(card).toBeVisible();
    await expect(card.getByTestId("avatar-group")).toHaveCount(0);
    await expect(card).toContainText("6/10");
  });
});
