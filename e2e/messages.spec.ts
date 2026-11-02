import { createAuthUser, expect, rpc, signIn, test } from "./fixtures";

// A 2×2 PNG: the page shrinks it to a JPEG before sending, as it does phone photos.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGPc9V+agYGBiYGBgYGBAQAWuQHYMNpr4AAAAABJRU5ErkJggg==",
  "base64",
);

test.describe("Conversations", () => {
  test("a picture sent in a conversation reaches the other member, privately", async ({ page, browser }) => {
    const [sender, receiver] = [await createAuthUser("Sender"), await createAuthUser("Receiver")];
    const conv = await rpc<string>(sender.id, "start_direct_conversation", { p_user_id: receiver.id });

    await signIn(page, sender);
    await page.goto(`/ar/messages/${conv}`);
    // The picture is read by the page's script: choose it once the page is interactive.
    await page.waitForLoadState("networkidle");
    await page.locator('input[type="file"][name="image"]').setInputFiles({ name: "pitch.png", mimeType: "image/png", buffer: PNG });
    // The chosen picture is previewed and can be removed; text is optional with a picture.
    await expect(page.getByRole("button", { name: "إزالة الصورة" })).toBeVisible();
    await page.getByRole("button", { name: "إرسال", exact: true }).click();
    await expect(page.getByRole("img", { name: "صورة مرسلة" })).toBeVisible();

    const other = await (await browser.newContext()).newPage();
    await signIn(other, receiver);
    await other.goto("/ar/messages");
    await expect(other.getByText("📷 صورة")).toBeVisible();
    await other.goto(`/ar/messages/${conv}`);
    const picture = other.getByRole("img", { name: "صورة مرسلة" });
    await expect(picture).toBeVisible();
    // It really loads (a signed link to the private bucket), and isn't a public address.
    await expect.poll(() => picture.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
    const src = (await picture.getAttribute("src"))!;
    expect(src).toContain("/storage/v1/object/sign/message-images/");
    // Without the signature, the file isn't served.
    expect((await other.request.get(src.replace("/object/sign/", "/object/public/").split("?")[0])).ok()).toBe(false);
    await other.context().close();
  });
});
