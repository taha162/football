import { randomUUID } from "node:crypto";
import { admin, createAuthUser, expect, mosul, rpc, signIn, test } from "./fixtures";

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

test.describe("Venue choice in the match form", () => {
  test("lists the chosen city's venues only, and follows a change of city", async ({ page }) => {
    const owner = await createAuthUser("Owner");
    const tag = randomUUID().slice(0, 6);
    const [{ id: baghdad }] = await admin<{ id: string }>("select id from public.cities where slug = 'baghdad'");
    await rpc(owner.id, "create_venue", { p_name: `Mosul Pitch ${tag}`, p_city_id: await mosul() });
    await rpc(owner.id, "create_venue", { p_name: `Baghdad Pitch ${tag}`, p_city_id: baghdad });

    // The organizer lives in Mosul: the form starts there, with Mosul's venues.
    const organizer = await createAuthUser("Organizer");
    await signIn(page, organizer);
    await page.goto("/ar/matches/new");
    const venue = page.getByRole("combobox", { name: "الملعب" });
    await expect(venue.locator("option", { hasText: `Mosul Pitch ${tag}` })).toHaveCount(1);
    await expect(venue.locator("option", { hasText: `Baghdad Pitch ${tag}` })).toHaveCount(0);

    // Another city: its venues replace the first city's (the database accepts only a venue in the match's city).
    await page.locator("summary", { hasText: "خيارات إضافية" }).click();
    await page.getByRole("combobox", { name: "المدينة" }).selectOption({ label: "بغداد" });
    await expect(venue.locator("option", { hasText: `Baghdad Pitch ${tag}` })).toHaveCount(1);
    await expect(venue.locator("option", { hasText: `Mosul Pitch ${tag}` })).toHaveCount(0);

    // Picked and published: the match is at that venue.
    await venue.selectOption({ label: `Baghdad Pitch ${tag}` });
    const title = `City venue ${tag}`;
    await page.getByRole("textbox", { name: "العنوان" }).fill(title);
    await page.getByRole("button", { name: "نشر المباراة" }).click();
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    const [row] = await admin<{ name: string }>("select v.name from public.matches m join public.venues v on v.id = m.venue_id where m.title = $1", [title]);
    expect(row.name).toBe(`Baghdad Pitch ${tag}`);
  });
});
