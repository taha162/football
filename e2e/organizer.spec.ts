import { createAuthUser, expect, rpc, signIn, test } from "./fixtures";

test.describe("Journey B — organizer creates and manages a match", () => {
  test("creates a match with cost sharing, receives a player and manages the roster", async ({ page }) => {
    const organizer = await createAuthUser("Organizer");
    const player = await createAuthUser("Player");
    const title = `Journey B ${Date.now()}`;

    await signIn(page, organizer);
    await page.goto("/ar/matches/new");
    await page.getByRole("textbox", { name: "العنوان" }).fill(title);
    await page.getByRole("textbox", { name: "التكلفة الإجمالية" }).fill("50001");
    await expect(page.getByText(/يدفع كل لاعب من/)).toContainText("٥٬٠٠١");
    await page.getByRole("button", { name: "نشر المباراة" }).click();
    await page.waitForURL(/\/ar\/matches\/[0-9a-f-]{36}$/);
    const matchId = page.url().split("/").pop()!;
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    await expect(page.getByText(/٥٬٠٠١/).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "أدوات المنظم" })).toBeVisible();

    // A player joins (fixture through the same RPC the UI uses).
    await rpc(player.id, "join_match", { p_match_id: matchId });
    await page.reload();
    const row = page.getByRole("listitem").filter({ hasText: player.name });
    await expect(row).toBeVisible();

    // Manual payment tracking (never a "payment success").
    await row.getByLabel("الدفع (يدوي)").selectOption("paid");
    await row.getByRole("button", { name: "تحديث" }).click();
    await expect(page.getByRole("listitem").filter({ hasText: player.name }).locator("span", { hasText: "دفع (يدوياً)" })).toBeVisible();

    // Organizer confirms the match, then removes the player.
    await page.getByRole("button", { name: "تأكيد المباراة" }).click();
    await expect(page.getByText("مؤكدة", { exact: true }).first()).toBeVisible();
    await page.getByRole("listitem").filter({ hasText: player.name }).getByRole("button", { name: "إزالة" }).click();
    const dialog = page.getByRole("dialog", { name: `إزالة ${player.name}؟` });
    await dialog.getByRole("textbox").fill("Changed plans");
    await dialog.getByRole("button", { name: "إزالة" }).click();
    await expect(page.getByRole("listitem").filter({ hasText: player.name })).toHaveCount(0);
  });
});
