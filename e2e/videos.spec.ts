import { closeSync, ftruncateSync, openSync } from "node:fs";
import path from "node:path";
import { admin, createAuthUser, expect, rpc, signIn, test } from "./fixtures";

// A 3-second WebM (VP8, 192×144), made with ffmpeg's test pattern: Chromium plays it.
const CLIP = path.resolve("e2e/assets/clip.webm");
const storedIn = async (conversation: string) =>
  (await admin<{ name: string }>("select name from storage.objects where bucket_id = 'message-videos' and name like $1 order by name", [`${conversation}/%`])).map((r) => r.name);

/** Videos in conversations (migration 0045). */
test.describe("Videos", () => {
  test("a video goes with a still and its length; the other member gets it live, plays it inside the site and saves it; deleting removes it", async ({ page, browser }) => {
    const [me, friend] = [await createAuthUser("Filmer"), await createAuthUser("Watcher")];
    const conv = await rpc<string>(me.id, "start_direct_conversation", { p_user_id: friend.id });

    // The other member is in the conversation already: the video arrives while it's open.
    const other = await (await browser.newContext({ acceptDownloads: true })).newPage();
    await signIn(other, friend);
    await other.goto(`/ar/messages/${conv}`);
    await other.waitForLoadState("networkidle");

    await signIn(page, me);
    await page.goto(`/ar/messages/${conv}`);
    await page.waitForLoadState("networkidle"); // the box listens once the page is ready
    await page.locator('input[type="file"][name="image"]').setInputFiles(CLIP);
    // Previewed with its length, and removable before sending.
    await expect(page.getByRole("button", { name: "إزالة الفيديو" })).toBeVisible();
    await expect(page.getByText(/^[0٠]:[0٠][3٣]$/)).toBeVisible();
    await page.getByRole("textbox", { name: "اكتب رسالة" }).fill("هدف اليوم");
    await page.getByRole("button", { name: "إرسال", exact: true }).click();
    await expect(page.getByRole("button", { name: "إزالة الفيديو" })).toHaveCount(0);
    await expect(page.getByTestId("video-message")).toBeVisible();
    await expect(page.getByText("هدف اليوم")).toBeVisible();

    // Stored where it should be: the video and its still, in the conversation's folder.
    const [row] = await admin<{ id: string; video_path: string; video_seconds: number }>(
      "select id, video_path, video_seconds from public.messages where conversation_id = $1 and video_path is not null",
      [conv],
    );
    expect(row.video_seconds).toBe(3);
    expect(await storedIn(conv)).toEqual([row.video_path.replace(/\.webm$/, ".poster.jpg"), row.video_path].sort());

    // The other member: live, with the still; it plays inside the site, and «حفظ» saves it.
    const tile = other.getByTestId("video-message");
    await expect(tile).toBeVisible();
    await expect(tile.locator("img")).toHaveJSProperty("complete", true);
    await tile.click();
    const viewer = other.getByRole("dialog", { name: "فيديو مرسل" });
    await expect(viewer).toBeVisible();
    await expect.poll(() => viewer.locator("video").evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThan(0);
    expect(await viewer.locator("video").evaluate((v: HTMLVideoElement) => Math.round(v.duration))).toBe(3);
    const download = other.waitForEvent("download");
    await viewer.getByRole("button", { name: "حفظ" }).click();
    expect((await download).suggestedFilename()).toBe(`almalab-${row.id}.webm`);
    await other.keyboard.press("Escape");
    await expect(viewer).toHaveCount(0);
    await other.context().close();

    // The list says what it was, with its caption.
    await page.goto("/ar/messages");
    await expect(page.getByText("🎥 هدف اليوم")).toBeVisible();
    await page.goto(`/ar/messages/${conv}`);
    await page.waitForLoadState("networkidle"); // the box listens once the page is ready

    // Deleting it removes the files too.
    const mine = page.getByRole("listitem").filter({ has: page.getByTestId("video-message") });
    await mine.getByRole("button", { name: "خيارات الرسالة" }).click();
    await page.getByRole("dialog", { name: "خيارات الرسالة" }).getByRole("button", { name: "حذف" }).click();
    await page.getByRole("dialog", { name: "حذف الرسالة؟" }).getByRole("button", { name: "حذف" }).click();
    await expect(page.getByTestId("video-message")).toHaveCount(0);
    await expect.poll(() => storedIn(conv)).toEqual([]);
  });

  test("a file that isn't a video is refused after upload and removed; one over 50 MB is refused before", async ({ page }) => {
    const [me, friend] = [await createAuthUser("Faker"), await createAuthUser("Faked")];
    const conv = await rpc<string>(me.id, "start_direct_conversation", { p_user_id: friend.id });
    await signIn(page, me);
    await page.goto(`/ar/messages/${conv}`);
    await page.waitForLoadState("networkidle"); // the box listens once the page is ready
    const attach = page.locator('input[type="file"][name="image"]');

    // Text dressed as a video: storage takes it, the site reads its first bytes and refuses it.
    await attach.setInputFiles({ name: "goal.mp4", mimeType: "video/mp4", buffer: Buffer.from("<html><script>alert(1)</script></html>".repeat(20)) });
    await expect(page.getByRole("button", { name: "إزالة الفيديو" })).toBeVisible();
    await page.getByRole("button", { name: "إرسال", exact: true }).click();
    await expect(page.getByText("هذا النوع من الفيديو غير مدعوم. أرسل MP4 أو MOV أو WebM.")).toBeVisible();
    await expect.poll(() => storedIn(conv)).toEqual([]);
    expect(await admin("select 1 from public.messages where conversation_id = $1", [conv])).toHaveLength(0);

    // Too big: said at once, nothing uploaded. (An empty file of that size, taking no disk space.)
    const big = test.info().outputPath("match.mp4");
    const fd = openSync(big, "w");
    ftruncateSync(fd, 50 * 1024 * 1024 + 1);
    closeSync(fd);
    await attach.setInputFiles(big);
    await expect(page.getByText("الفيديو أكبر من 50 ميغابايت. اختر مقطعاً أقصر.")).toBeVisible();
    await expect(page.getByRole("button", { name: "إزالة الفيديو" })).toHaveCount(0);
  });
});
