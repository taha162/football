import { admin, createAuthUser, expect, rpc, signIn, test, type TestUser } from "./fixtures";

// A 2×2 PNG: the page makes it a JPEG before sending, as it does phone photos.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGPc9V+agYGBiYGBgYGBAQAWuQHYMNpr4AAAAABJRU5ErkJggg==",
  "base64",
);

const usernameOf = async (id: string) => (await admin<{ username: string }>("select username from public.profiles where id = $1", [id]))[0].username;
async function befriend(a: TestUser, b: TestUser) {
  await rpc(a.id, "send_friend_request", { p_username: await usernameOf(b.id) });
  await rpc(b.id, "respond_friend_request", { p_user_id: a.id, p_accept: true });
}

/** Group conversations of friends, with admins (migrations 0043–0044). */
test.describe("Groups", () => {
  test("a member makes a group of friends; they talk; admins manage it from its page; leaving hands it on", async ({ page, browser }) => {
    test.setTimeout(150_000);
    const [a, b, c] = [await createAuthUser("Captain"), await createAuthUser("Winger"), await createAuthUser("Keeper")];
    await befriend(a, b);
    await befriend(a, c);

    await signIn(page, a);
    await page.goto("/ar/messages");
    await page.getByRole("link", { name: "مجموعة جديدة" }).click();
    await page.waitForURL(/\/ar\/messages\/groups\/new/);
    await expect(page.getByRole("heading", { name: "مجموعة جديدة", level: 1 })).toBeVisible();
    // No name, nobody ticked: both said.
    await page.getByRole("button", { name: "إنشاء المجموعة" }).click();
    await expect(page.getByRole("textbox", { name: "اسم المجموعة" })).toBeFocused();
    await page.getByRole("textbox", { name: "اسم المجموعة" }).fill("خماسي الجمعة");
    await page.getByRole("button", { name: "إنشاء المجموعة" }).click();
    await expect(page.getByText("اختر صديقاً واحداً على الأقل.")).toBeVisible();
    await page.getByRole("checkbox", { name: new RegExp(b.name) }).check();
    await page.getByRole("checkbox", { name: new RegExp(c.name) }).check();
    await expect(page.getByText("اخترت صديقين")).toBeVisible();
    await page.getByRole("button", { name: "إنشاء المجموعة" }).click();
    await page.waitForURL(/\/ar\/messages\/[0-9a-f-]{36}$/);
    const groupUrl = page.url();
    await expect(page.getByRole("heading", { name: "خماسي الجمعة", level: 1 })).toBeVisible();
    // Counted the way the site writes numbers (٣ or 3).
    await expect(page.getByText(/^[3٣] أعضاء$/)).toBeVisible();
    await page.getByRole("textbox", { name: "اكتب رسالة" }).fill("نلعب الجمعة؟");
    await page.getByRole("button", { name: "إرسال", exact: true }).click();
    await expect(page.getByText("نلعب الجمعة؟")).toBeVisible();

    // B hears of it, opens it from the bell, sees who wrote, and answers.
    const other = await (await browser.newContext()).newPage();
    await signIn(other, b);
    await other.goto("/ar/notifications");
    await other.getByRole("link", { name: `${a.name} أضافك إلى مجموعة «خماسي الجمعة».` }).click();
    await other.waitForURL(groupUrl);
    await expect(other.getByText("نلعب الجمعة؟")).toBeVisible();
    await expect(other.getByText(a.name, { exact: true })).toBeVisible();
    await other.getByRole("textbox", { name: "اكتب رسالة" }).fill("أكيد");
    await other.getByRole("button", { name: "إرسال", exact: true }).click();
    await expect(other.getByText("أكيد", { exact: true })).toBeVisible();
    // A member sees the members, not the admin buttons.
    await other.getByRole("link", { name: /معلومات المجموعة/ }).click();
    await other.waitForURL(/\/group$/);
    const othersMembers = other.getByRole("region", { name: "الأعضاء (3)" });
    await expect(othersMembers.getByRole("listitem").filter({ hasText: a.name }).getByText("مشرف", { exact: true })).toBeVisible();
    await expect(othersMembers.getByRole("button", { name: "إزالة" })).toHaveCount(0);
    await expect(other.getByText("المشرفون يضيفون الأعضاء ويزيلونهم ويغيّرون الاسم.")).toBeVisible();

    // A, the admin: makes B an admin, removes C, renames it.
    await page.getByRole("link", { name: /معلومات المجموعة/ }).click();
    await page.waitForURL(/\/group$/);
    const members = page.getByRole("region", { name: "الأعضاء (3)" });
    await members.getByRole("listitem").filter({ hasText: b.name }).getByRole("button", { name: "تعيين مشرفاً" }).click();
    await expect(page.getByRole("listitem").filter({ hasText: b.name }).getByText("مشرف", { exact: true })).toBeVisible();
    await members.getByRole("listitem").filter({ hasText: c.name }).getByRole("button", { name: "إزالة" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "إزالة" }).click();
    await expect(page.getByRole("region", { name: "الأعضاء (2)" })).toBeVisible();
    await page.getByRole("textbox", { name: "الاسم" }).fill("خماسي الجمعة — الملعب الكبير");
    await page.getByRole("button", { name: "حفظ الاسم" }).click();
    await expect(page.getByRole("heading", { name: "خماسي الجمعة — الملعب الكبير", level: 1 })).toBeVisible();

    // C is out: the conversation is gone for them.
    const third = await (await browser.newContext()).newPage();
    await signIn(third, c);
    await third.goto(groupUrl);
    await expect(third.getByRole("heading", { name: "خماسي الجمعة — الملعب الكبير" })).toHaveCount(0);
    await third.context().close();

    // A leaves; B stays, as its admin.
    await page.getByRole("button", { name: "مغادرة المجموعة" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "مغادرة المجموعة" }).click();
    await page.waitForURL(/\/ar\/messages$/);
    await expect(page.getByText("خماسي الجمعة — الملعب الكبير")).toHaveCount(0);
    await other.reload();
    await expect(other.getByRole("region", { name: "الأعضاء (1)" })).toBeVisible();
    await expect(other.getByRole("textbox", { name: "الاسم" })).toBeVisible();
    await other.context().close();
  });

  test("an admin adds a friend from the group's page; someone without friends is sent to find some", async ({ page }) => {
    const [a, b, c, lonely] = [await createAuthUser("Adder"), await createAuthUser("Added first"), await createAuthUser("Added later"), await createAuthUser("Lonely")];
    await befriend(a, b);
    await befriend(a, c);
    const group = await rpc<string>(a.id, "create_group", { p_title: "Training", p_member_ids: [b.id] });

    await signIn(page, a);
    await page.goto(`/ar/messages/${group}/group`);
    const add = page.getByRole("region", { name: "إضافة أعضاء" });
    // Only friends who aren't in it yet.
    await expect(add.getByRole("checkbox")).toHaveCount(1);
    await add.getByRole("checkbox", { name: new RegExp(c.name) }).check();
    await add.getByRole("button", { name: "إضافة" }).click();
    await expect(page.getByRole("region", { name: "الأعضاء (3)" })).toBeVisible();
    await expect(add.getByText("كل أصدقائك في المجموعة.")).toBeVisible();

    await page.context().clearCookies();
    await signIn(page, lonely);
    await page.goto("/ar/messages/groups/new");
    await expect(page.getByText("أضف أصدقاء أولاً")).toBeVisible();
    await page.getByRole("link", { name: "إلى الأصدقاء" }).click();
    await page.waitForURL(/\/ar\/friends/);
  });

  test("an admin gives the group a photo; members see it in the bar and the list, and can't change it", async ({ page, browser }) => {
    const [a, b] = [await createAuthUser("Photo admin"), await createAuthUser("Photo member")];
    await befriend(a, b);
    const group = await rpc<string>(a.id, "create_group", { p_title: "صورة الفريق", p_member_ids: [b.id] });
    const photoOf = async () => (await admin<{ photo_path: string | null }>("select photo_path from public.conversations where id = $1", [group]))[0].photo_path;

    await signIn(page, a);
    await page.goto(`/ar/messages/${group}/group`);
    await page.waitForLoadState("networkidle");
    await page.getByLabel("صورة المجموعة").setInputFiles({ name: "team.png", mimeType: "image/png", buffer: PNG });
    await page.getByRole("button", { name: "حفظ الصورة" }).click();
    await expect(page.getByText("تم حفظ صورة المجموعة.")).toBeVisible();
    const first = await photoOf();
    expect(first).toMatch(new RegExp(`^${group}/[0-9a-f-]{36}\\.(jpg|png|webp)$`));
    // Changing it removes the old file.
    await page.getByLabel("تغيير صورة المجموعة").setInputFiles({ name: "team2.png", mimeType: "image/png", buffer: PNG });
    await page.getByRole("button", { name: "حفظ الصورة" }).click();
    await expect.poll(photoOf).not.toBe(first);
    await expect.poll(async () => (await admin("select 1 from storage.objects where bucket_id = 'group-photos' and name = $1", [first])).length).toBe(0);

    // A member: the photo in the conversation's bar and the list, no way to change it.
    const other = await (await browser.newContext()).newPage();
    await signIn(other, b);
    await other.goto(`/ar/messages/${group}/group`);
    await expect(other.getByRole("button", { name: "حفظ الصورة" })).toHaveCount(0);
    await other.goto(`/ar/messages/${group}`);
    await expect(other.locator(`header img[src*="group-photos"]`)).toBeVisible();
    await other.goto("/ar/messages");
    await expect(other.locator(`img[src*="group-photos"]`)).toBeVisible();
    await other.context().close();

    // Removed: gone from the group and from storage.
    const second = await photoOf();
    await page.getByRole("button", { name: "إزالة الصورة" }).click();
    await expect.poll(photoOf).toBeNull();
    await expect.poll(async () => (await admin("select 1 from storage.objects where bucket_id = 'group-photos' and name = $1", [second])).length).toBe(0);
  });
});
