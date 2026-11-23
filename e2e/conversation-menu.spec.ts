import { createAuthUser, expect, rpc, signIn, test } from "./fixtures";

/** A conversation's menu in the list (migration 0040): everything in it is the member's own. */
test.describe("A conversation's menu in the list", () => {
  test("pin, mute, favourite, a nickname and delete for me", async ({ page }) => {
    const me = await createAuthUser("Menu me");
    const [a, b] = [await createAuthUser("Menu a"), await createAuthUser("Menu b")];
    const convA = await rpc<string>(a.id, "start_direct_conversation", { p_user_id: me.id });
    await rpc(a.id, "send_message", { p_conversation_id: convA, p_body: "من أ" });
    const convB = await rpc<string>(b.id, "start_direct_conversation", { p_user_id: me.id });
    await rpc(b.id, "send_message", { p_conversation_id: convB, p_body: "رسالة قديمة من ب" });

    await signIn(page, me);
    await page.goto("/ar/messages");
    // The menu is the page's script: open it once the page is interactive.
    await page.waitForLoadState("networkidle");
    const rowA = page.locator("li", { hasText: a.name });
    const rowB = page.locator("li", { hasText: b.name });
    // B wrote last, so B comes first.
    await expect(page.locator("main li").first()).toContainText(b.name);

    // A right click opens the menu, named after the conversation.
    await rowA.click({ button: "right" });
    const menu = page.getByRole("dialog", { name: a.name });
    await expect(menu).toBeVisible();
    await menu.getByRole("button", { name: "تثبيت المحادثة" }).click();
    await expect(menu).toBeHidden();
    await expect(page.locator("main li").first()).toContainText(a.name);
    await expect(rowA.getByText("مثبّتة")).toBeAttached();

    // Muted for 8 hours.
    await rowB.click({ button: "right" });
    await page.getByRole("button", { name: "كتم الإشعارات" }).click();
    await page.getByRole("button", { name: "8 ساعات" }).click();
    await expect(rowB.getByText("مكتومة")).toBeAttached();

    // A favourite: the «المفضلة» filter keeps it alone.
    await rowA.click({ button: "right" });
    await page.getByRole("button", { name: "إضافة إلى المفضلة" }).click();
    await page.getByRole("link", { name: "المفضلة" }).click();
    await page.waitForURL(/filter=favorites/);
    await expect(page.locator("main li")).toHaveCount(1);
    await expect(page.locator("main li")).toContainText(a.name);
    await page.getByRole("link", { name: "الكل" }).click();
    await page.waitForURL(/\/ar\/messages$/);

    // A nickname, in the list and on the conversation's own screen; «⌄» on a computer opens the same menu.
    await rowA.hover();
    await rowA.getByRole("button", { name: `خيارات محادثة ${a.name}` }).click();
    await page.getByRole("button", { name: "إضافة كنية" }).click();
    await page.getByRole("textbox", { name: "الكنية" }).fill("الكابتن");
    await page.getByRole("button", { name: "حفظ" }).click();
    const captain = page.locator("li", { hasText: "الكابتن" });
    await expect(captain).toBeVisible();
    await captain.getByRole("link").click();
    await page.waitForURL(new RegExp(`/ar/messages/${convA}`));
    await expect(page.getByRole("heading", { name: "الكابتن" })).toBeVisible();
    await page.getByRole("link", { name: "رجوع" }).click();
    await page.waitForURL(/\/ar\/messages$/);

    // Delete for me: gone from my list; back with the next message, without what came before.
    await rowB.click({ button: "right" });
    await page.getByRole("button", { name: "حذف المحادثة" }).click();
    await expect(page.getByText("تختفي من قائمتك", { exact: false })).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: "حذف المحادثة" }).click();
    await expect(rowB).toHaveCount(0);
    await rpc(b.id, "send_message", { p_conversation_id: convB, p_body: "رسالة جديدة من ب" });
    await page.reload();
    await expect(rowB).toBeVisible();
    await rowB.getByRole("link").click();
    await page.waitForURL(new RegExp(`/ar/messages/${convB}`));
    await expect(page.getByText("رسالة جديدة من ب")).toBeVisible();
    await expect(page.getByText("رسالة قديمة من ب")).toHaveCount(0);
  });
});
