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

  test.describe("location", () => {
    test.use({ geolocation: { latitude: 36.3456, longitude: 43.1234, accuracy: 12 }, permissions: ["geolocation"] });

    test("the current location is shown with its accuracy, sent on confirmation, and opens in maps", async ({ page, browser }) => {
      const [sender, receiver] = [await createAuthUser("Sender"), await createAuthUser("Receiver")];
      const conv = await rpc<string>(sender.id, "start_direct_conversation", { p_user_id: receiver.id });

      await signIn(page, sender);
      await page.goto(`/ar/messages/${conv}`);
      await page.waitForLoadState("networkidle");
      await page.getByRole("button", { name: "إرسال موقعي" }).click();
      const panel = page.getByTestId("location-panel");
      await expect(panel.getByText("الدقة ± ١٢ م")).toBeVisible();
      // Nothing is sent until confirmed; cancelling brings the text box back.
      await panel.getByRole("button", { name: "إلغاء" }).click();
      await expect(page.getByRole("textbox", { name: "اكتب رسالة" })).toBeVisible();
      await page.getByRole("button", { name: "إرسال موقعي" }).click();
      await page.getByTestId("location-panel").getByRole("button", { name: "إرسال الموقع" }).click();
      const card = page.getByTestId("location-card");
      await expect(card).toBeVisible();
      await expect(card).toHaveAttribute("href", "https://www.google.com/maps/search/?api=1&query=36.345600,43.123400");
      await expect(card).toContainText("فتح في الخرائط");

      const other = await (await browser.newContext()).newPage();
      await signIn(other, receiver);
      await other.goto("/ar/messages");
      await expect(other.getByText("📍 الموقع")).toBeVisible();
      await other.goto(`/ar/messages/${conv}`);
      await expect(other.getByTestId("location-card")).toContainText("الدقة ± ١٢ م");
      await other.context().close();
    });
  });

  test("a voice note is recorded, sent in one tap, and plays for the other member from a private link", async ({ page, browser }) => {
    const [sender, receiver] = [await createAuthUser("Sender"), await createAuthUser("Receiver")];
    const conv = await rpc<string>(sender.id, "start_direct_conversation", { p_user_id: receiver.id });

    // The other member already has the conversation open.
    const other = await (await browser.newContext()).newPage();
    await signIn(other, receiver);
    await other.goto(`/ar/messages/${conv}`);
    await other.waitForLoadState("networkidle");

    await signIn(page, sender);
    await page.goto(`/ar/messages/${conv}`);
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "تسجيل رسالة صوتية" }).click();
    const recorder = page.getByTestId("voice-recorder");
    await expect(recorder.getByText("جارٍ التسجيل")).toBeVisible();
    // Two seconds of the fake microphone's tone.
    await expect(recorder.getByText("٠:٠٢")).toBeVisible({ timeout: 8_000 });
    await recorder.getByRole("button", { name: "إرسال الرسالة الصوتية" }).click();
    await expect(page.getByTestId("voice-note")).toBeVisible();
    await expect(page.getByRole("textbox", { name: "اكتب رسالة" })).toBeVisible();

    // It arrives live, without reloading, with its own private link.
    const note = other.getByTestId("voice-note");
    await expect(note).toBeVisible();
    await expect(note.getByText(/^[٠-٩]:[٠-٩]{2}$/)).toBeVisible();
    const src = (await note.locator("audio").getAttribute("src"))!;
    expect(src).toContain("/storage/v1/object/sign/message-voice/");
    const file = await other.request.get(src);
    expect(file.ok()).toBe(true);
    expect(file.headers()["content-type"]).toMatch(/^audio\/(webm|ogg|mp4)/);
    expect((await file.body()).length).toBeGreaterThan(1000);
    // It plays.
    await note.getByRole("button", { name: "تشغيل الرسالة الصوتية" }).click();
    await expect(note.getByRole("button", { name: "إيقاف مؤقت" })).toBeVisible();
    await other.goto("/ar/messages");
    await expect(other.getByText("🎤 رسالة صوتية")).toBeVisible();
    await other.context().close();
  });
});
