import { admin, createAuthUser, expect, signIn, test } from "./fixtures";

const usernameOf = async (id: string) => (await admin<{ username: string }>("select username from public.profiles where id = $1", [id]))[0].username;

/** Friends, added by username (migration 0042). */
test.describe("Friends", () => {
  test("a friend is found by username, asked, accepts from the notification, and they can message each other", async ({ page, browser }) => {
    const [a, b] = [await createAuthUser("Friend A"), await createAuthUser("Friend B")];
    const bName = await usernameOf(b.id);

    await signIn(page, a);
    await page.getByRole("button", { name: `قائمة حساب ${a.name}` }).click();
    await page.getByRole("menuitem", { name: "أصدقائي" }).click();
    await page.waitForURL(/\/ar\/friends/);
    await expect(page.getByRole("heading", { name: "الأصدقاء", level: 1 })).toBeVisible();

    // Nobody by that name.
    const search = page.getByRole("searchbox", { name: "اسم مستخدم صديقك" }).or(page.getByRole("textbox", { name: "اسم مستخدم صديقك" }));
    await search.fill("nobody_by_this_name");
    await page.getByRole("button", { name: "بحث" }).click();
    await expect(page.getByText("لا يوجد عضو باسم المستخدم @nobody_by_this_name.")).toBeVisible();

    // Typed with @ and capitals: found all the same.
    await search.fill(`@${bName.toUpperCase()}`);
    await page.getByRole("button", { name: "بحث" }).click();
    const result = page.getByRole("list", { name: "نتيجة البحث" });
    await expect(result.getByText(b.name)).toBeVisible();
    // Lists show the name only; the username is on their page.
    await expect(result.getByText(`@${bName}`)).toHaveCount(0);
    // The button gives way to where they stand now.
    await result.getByRole("button", { name: "إضافة صديق" }).click();
    await expect(result.getByText("تم إرسال الطلب")).toBeVisible();
    await expect(page.getByRole("heading", { name: "طلبات أرسلتها (1)" })).toBeVisible();

    // B: the notification opens «الأصدقاء», where the request waits.
    const other = await (await browser.newContext()).newPage();
    await signIn(other, b);
    await other.goto("/ar/notifications");
    await other.getByRole("link", { name: `${a.name} يريد أن يكون صديقك.` }).click();
    await other.waitForURL(/\/ar\/friends/);
    const requests = other.getByRole("region", { name: "طلبات الصداقة (1)" });
    await expect(requests.getByRole("link", { name: new RegExp(a.name) })).toBeVisible();
    await requests.getByRole("button", { name: "قبول" }).click();
    const friends = other.getByRole("region", { name: "أصدقائي (1)" });
    await expect(friends.getByRole("link", { name: new RegExp(a.name) })).toBeVisible();

    // A sees «صديقك» on B's page; B messages A from the list.
    await page.goto(`/ar/players/${b.id}`);
    await expect(page.getByText("صديقك", { exact: true })).toBeVisible();
    await friends.getByRole("button", { name: "مراسلة" }).click();
    await other.waitForURL(/\/ar\/messages\/[0-9a-f-]{36}/);
    await other.context().close();

    // Removing ends it; the page then offers to add again.
    await page.goto("/ar/friends");
    const mine = page.getByRole("region", { name: "أصدقائي (1)" });
    await mine.getByRole("button", { name: "إزالة" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "إزالة" }).click();
    await expect(page.getByRole("region", { name: "أصدقائي (0)" })).toBeVisible();
  });

  test("a player's page offers «إضافة صديق», and the request shows there", async ({ page }) => {
    const [me, them] = [await createAuthUser("Visitor"), await createAuthUser("Visited")];
    await signIn(page, me);
    await page.goto(`/ar/players/${them.id}`);
    await page.getByRole("button", { name: "إضافة صديق" }).click();
    await expect(page.getByText("تم إرسال الطلب", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "إلغاء الطلب" }).click();
    await expect(page.getByRole("button", { name: "إضافة صديق" })).toBeVisible();
  });
});
