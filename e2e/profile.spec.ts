import type { Page } from "@playwright/test";
import { admin, createAuthUser, expect, signIn, test, type TestUser } from "./fixtures";

/** An 8×8 lime PNG. */
const PHOTO = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAFUlEQVR42mPc8cmeARtgYsABBqcEAIHGAfltyicCAAAAAElFTkSuQmCC", "base64");

async function uploadPhoto(page: Page, user: TestUser) {
  await signIn(page, user);
  await page.goto("/en/profile");
  await page.getByLabel("Profile photo").setInputFiles({ name: "me.png", mimeType: "image/png", buffer: PHOTO });
  await page.getByRole("button", { name: "Upload photo" }).click();
}

const headerAvatar = (page: Page) => page.locator("summary.menu-trigger > span");

// The last test makes the avatars bucket private for a moment: keep these in sequence.
test.describe.configure({ mode: "serial" });

test.describe("Profile photo", () => {
  test("an uploaded photo shows as the avatar", async ({ page }) => {
    await uploadPhoto(page, await createAuthUser("Photo"));
    await expect(page.getByText("Photo updated.")).toBeVisible();
    const img = headerAvatar(page).locator("img");
    await expect(img).toBeVisible();
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
  });

  test("a photo that cannot load falls back to initials, never a broken image", async ({ page }) => {
    await uploadPhoto(page, await createAuthUser("Broken"));
    await expect(page.getByText("Photo updated.")).toBeVisible();
    // From here on, neither the optimized copy nor the original file can be fetched.
    await page.route("**/storage/v1/object/public/avatars/**", (route) => route.abort());
    await page.route("**/_next/image?**", (route) => route.abort());
    await page.reload();
    await expect(headerAvatar(page).locator("img")).toHaveCount(0);
    await expect(headerAvatar(page)).toHaveText(/^\p{L}{1,2}$/u);
  });

  test("when picture storage is not public, the upload is refused with a clear message", async ({ page }) => {
    const user = await createAuthUser("Private");
    await admin("update storage.buckets set public = false where id = 'avatars'");
    try {
      await uploadPhoto(page, user);
      await expect(page.getByText("The picture couldn't be published: picture storage isn't open to the public yet.", { exact: false })).toBeVisible();
      await expect(headerAvatar(page).locator("img")).toHaveCount(0);
    } finally {
      await admin("update storage.buckets set public = true where id = 'avatars'");
    }
  });
});
