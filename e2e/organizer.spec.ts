import { createAuthUser, expect, rpc, signIn, test } from "./fixtures";

test.describe("Journey B — organizer creates and manages a match", () => {
  test("creates a match with cost sharing, receives a player and manages the roster", async ({ page }) => {
    const organizer = await createAuthUser("Organizer");
    const player = await createAuthUser("Player");
    const title = `Journey B ${Date.now()}`;

    await signIn(page, organizer);
    await page.goto("/en/matches/new");
    await page.getByRole("textbox", { name: "Title" }).fill(title);
    await page.getByRole("textbox", { name: "Total cost" }).fill("50001");
    await expect(page.getByText(/Each of 10 players pays about/)).toContainText("5,001");
    await page.getByRole("button", { name: "Publish match" }).click();
    await page.waitForURL(/\/en\/matches\/[0-9a-f-]{36}$/);
    const matchId = page.url().split("/").pop()!;
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    await expect(page.getByText("IQD 5,001").or(page.getByText("5,001")).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Organizer tools" })).toBeVisible();

    // A player joins (fixture through the same RPC the UI uses).
    await rpc(player.id, "join_match", { p_match_id: matchId });
    await page.reload();
    const row = page.getByRole("listitem").filter({ hasText: player.name });
    await expect(row).toBeVisible();

    // Manual payment tracking (never a "payment success").
    await row.getByLabel("Payment (manual)").selectOption("paid");
    await row.getByRole("button", { name: "Update" }).click();
    await expect(page.getByRole("listitem").filter({ hasText: player.name }).locator("span", { hasText: "Paid (marked)" })).toBeVisible();

    // Organizer confirms the match, then removes the player.
    await page.getByRole("button", { name: "Confirm match" }).click();
    await expect(page.getByText("Confirmed", { exact: true }).first()).toBeVisible();
    await page.getByRole("listitem").filter({ hasText: player.name }).getByRole("button", { name: "Remove" }).click();
    const dialog = page.getByRole("dialog", { name: `Remove ${player.name}?` });
    await dialog.getByRole("textbox").fill("Changed plans");
    await dialog.getByRole("button", { name: "Remove" }).click();
    await expect(page.getByRole("listitem").filter({ hasText: player.name })).toHaveCount(0);
  });
});
