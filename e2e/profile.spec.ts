import type { Page } from "@playwright/test";
import { admin, choosePhonePhoto, createAuthUser, expect, signIn, storedPictureSize, test, type TestUser } from "./fixtures";

/** An 8×8 lime PNG. */
const PHOTO = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAFUlEQVR42mPc8cmeARtgYsABBqcEAIHGAfltyicCAAAAAElFTkSuQmCC", "base64");

async function uploadPhoto(page: Page, user: TestUser) {
  await signIn(page, user);
  await page.goto("/ar/profile");
  await page.getByLabel("الصورة الشخصية").setInputFiles({ name: "me.png", mimeType: "image/png", buffer: PHOTO });
  await page.getByRole("button", { name: "رفع صورة" }).click();
}

const headerAvatar = (page: Page) => page.locator("button.menu-trigger > span");

// The last test makes the avatars bucket private for a moment: keep these in sequence.
test.describe.configure({ mode: "serial" });

test.describe("Profile photo", () => {
  test("an uploaded photo shows as the avatar", async ({ page }) => {
    await uploadPhoto(page, await createAuthUser("Photo"));
    await expect(page.getByText("تم تحديث الصورة.")).toBeVisible();
    const img = headerAvatar(page).locator("img");
    await expect(img).toBeVisible();
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
  });

  test("a photo that cannot load falls back to initials, never a broken image", async ({ page }) => {
    await uploadPhoto(page, await createAuthUser("Broken"));
    await expect(page.getByText("تم تحديث الصورة.")).toBeVisible();
    // From here on, neither the optimized copy nor the original file can be fetched.
    await page.route("**/storage/v1/object/public/avatars/**", (route) => route.abort());
    await page.route("**/_next/image?**", (route) => route.abort());
    await page.reload();
    await expect(headerAvatar(page).locator("img")).toHaveCount(0);
    await expect(headerAvatar(page)).toHaveText(/^\p{L}{1,2}$/u);
  });

  test("a phone-sized photo is made smaller before it is sent, stays upright, and becomes the avatar", async ({ page }) => {
    const user = await createAuthUser("Big photo");
    await signIn(page, user);
    await page.goto("/ar/profile");
    // Over the 4.5 MB the host accepts in one request: before, the page broke («حدث خطأ ما»).
    expect(await choosePhonePhoto(page.getByLabel("الصورة الشخصية"))).toBeGreaterThan(4.5 * 1024 * 1024);
    await page.getByRole("button", { name: "رفع صورة" }).click();
    await expect(page.getByText("تم تحديث الصورة.")).toBeVisible();
    const [stored] = await admin<{ size: number; name: string }>(
      "select (o.metadata ->> 'size')::int as size, o.name from public.profiles p join storage.objects o on o.bucket_id = 'avatars' and o.name = p.avatar_path where p.id = $1",
      [user.id],
    );
    expect(stored.size).toBeGreaterThan(0);
    expect(stored.size).toBeLessThan(1_500_000);
    // Taken upright (stored on its side, with the tag to turn it): it arrives upright, 1600 px tall.
    expect(await storedPictureSize(page, `avatars/${stored.name}`)).toEqual({ width: 1200, height: 1600 });
  });

  test("a profile picture opens large inside the site, with no «حفظ»", async ({ page, browser }) => {
    const user = await createAuthUser("Big face");
    await uploadPhoto(page, user);
    await expect(page.getByText("تم تحديث الصورة.")).toBeVisible();
    // On a player's page, seen by someone else.
    const other = await (await browser.newContext()).newPage();
    await signIn(other, await createAuthUser("Looker"));
    await other.goto(`/ar/players/${user.id}`);
    await other.getByRole("button", { name: `تكبير صورة ${user.name}` }).click();
    const viewer = other.getByRole("dialog", { name: `صورة ${user.name}` });
    await expect(viewer).toBeVisible();
    await expect.poll(() => viewer.getByRole("img").evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
    await expect(viewer.getByRole("button", { name: "حفظ" })).toHaveCount(0);
    await viewer.getByRole("button", { name: "إغلاق" }).click();
    await expect(viewer).toBeHidden();
    await expect(other).toHaveURL(new RegExp(`/ar/players/${user.id}`));
    await other.context().close();
  });

  test("when picture storage is not public, the upload is refused with a clear message", async ({ page }) => {
    const user = await createAuthUser("Private");
    await admin("update storage.buckets set public = false where id = 'avatars'");
    try {
      await uploadPhoto(page, user);
      await expect(page.getByText("تعذّر نشر الصورة: مخزن الصور غير مفتوح للعرض العام بعد.", { exact: false })).toBeVisible();
      await expect(headerAvatar(page).locator("img")).toHaveCount(0);
    } finally {
      await admin("update storage.buckets set public = true where id = 'avatars'");
    }
  });
});
