import { admin, createAuthUser, expect, rpc, signIn, test } from "./fixtures";

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
    // Send sits on the right; the picture, location and voice tools on the left.
    const sendBox = (await page.getByRole("button", { name: "إرسال", exact: true }).boundingBox())!;
    for (const tool of ["إرسال موقعي", "تسجيل رسالة صوتية"]) {
      expect((await page.getByRole("button", { name: tool }).boundingBox())!.x).toBeLessThan(sendBox.x);
    }
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

  test("your own green messages sit on the right, the other person's on the left", async ({ page, browser }) => {
    const [me, friend] = [await createAuthUser("Me"), await createAuthUser("Friend")];
    const conv = await rpc<string>(me.id, "start_direct_conversation", { p_user_id: friend.id });
    await rpc(me.id, "send_message", { p_conversation_id: conv, p_body: "Sent by Me" });
    await rpc(friend.id, "send_message", { p_conversation_id: conv, p_body: "Sent by Friend" });

    const sides = async (p: typeof page, own: string, other: string) => {
      const list = p.getByRole("list", { name: "سجل الرسائل" });
      await expect(list.getByText(own)).toBeVisible();
      const [box, a, b] = [await list.boundingBox(), await list.getByText(own).boundingBox(), await list.getByText(other).boundingBox()];
      // Own bubble against the right edge (inside the list's padding), the other's against the left.
      expect(box!.x + box!.width - (a!.x + a!.width)).toBeLessThan(40);
      expect(b!.x - box!.x).toBeLessThan(40);
      // Own is the green one.
      const colour = (text: string) => list.getByText(text).evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(await colour(own)).not.toBe(await colour(other));
    };
    await signIn(page, me);
    await page.goto(`/ar/messages/${conv}`);
    await sides(page, "Sent by Me", "Sent by Friend");
    const other = await (await browser.newContext()).newPage();
    await signIn(other, friend);
    await other.goto(`/ar/messages/${conv}`);
    await sides(other, "Sent by Friend", "Sent by Me");
    await other.context().close();
  });

  test("a text message is in the conversation the moment it is sent, and comes back to the box if it can't be sent", async ({ page }) => {
    const [me, friend] = [await createAuthUser("Quick"), await createAuthUser("Friend")];
    const conv = await rpc<string>(me.id, "start_direct_conversation", { p_user_id: friend.id });
    await signIn(page, me);
    await page.goto(`/ar/messages/${conv}`);
    await page.waitForLoadState("networkidle");
    const list = page.getByRole("list", { name: "سجل الرسائل" });
    const box = page.locator("#message-body");
    const send = page.getByRole("button", { name: "إرسال", exact: true });
    // What the send does to the server: held back, or lost on the way.
    let sending: "slow" | "lost" = "slow";
    await page.route(
      (url) => url.pathname === `/ar/messages/${conv}`,
      async (route) => {
        if (route.request().method() !== "POST" || !route.request().headers()["next-action"]) return route.continue();
        if (sending === "lost") return route.abort("internetdisconnected");
        await new Promise((r) => setTimeout(r, 1500));
        await route.continue();
      },
    );

    // The message shows at once, marked as on its way, and the box is free for the next one.
    await box.fill("On my way");
    await send.click();
    await expect(list.locator("li[data-pending]", { hasText: "On my way" })).toBeVisible({ timeout: 1000 });
    await expect(list.getByText("جارٍ الإرسال…")).toBeVisible();
    await expect(box).toHaveValue("");
    await box.fill("Next one");
    // Sent: a single copy, no longer marked; what was written meanwhile is still in the box.
    await expect(list.locator("li:not([data-pending])", { hasText: "On my way" })).toBeVisible();
    await expect(list.locator("li", { hasText: "On my way" })).toHaveCount(1);
    await expect(list.getByText("جارٍ الإرسال…")).toHaveCount(0);
    await expect(box).toHaveValue("Next one");

    // Lost on the way: the message is taken back, its text returns to the box, and the page says so.
    sending = "lost";
    await box.fill("Lost words");
    await send.click();
    await expect(page.getByText("حدث خطأ ما. يرجى المحاولة مرة أخرى.")).toBeVisible();
    await expect(list.locator("li", { hasText: "Lost words" })).toHaveCount(0);
    await expect(box).toHaveValue("Lost words");
    // Only the message that was sent is stored.
    const stored = await admin<{ body: string }>("select body from public.messages where conversation_id = $1 order by id", [conv]);
    expect(stored.map((m) => m.body)).toEqual(["On my way"]);
  });

  test("the sender edits or deletes their message, and the other member sees it change live", async ({ page, browser }) => {
    const [sender, receiver] = [await createAuthUser("Sender"), await createAuthUser("Receiver")];
    const conv = await rpc<string>(sender.id, "start_direct_conversation", { p_user_id: receiver.id });
    await rpc(sender.id, "send_message", { p_conversation_id: conv, p_body: "Kick-off at 8" });
    await rpc(sender.id, "send_message", { p_conversation_id: conv, p_body: "Wrong chat, sorry" });

    await signIn(page, sender);
    await page.goto(`/ar/messages/${conv}`);
    await page.waitForLoadState("networkidle");
    const other = await (await browser.newContext()).newPage();
    await signIn(other, receiver);
    await other.goto(`/ar/messages/${conv}`);
    await other.waitForLoadState("networkidle");
    const theirs = other.getByRole("list", { name: "سجل الرسائل" });
    await expect(theirs.getByText("Kick-off at 8")).toBeVisible();
    // Only the sender has the options; the other member can report instead.
    await expect(theirs.getByRole("button", { name: "خيارات الرسالة" })).toHaveCount(0);

    // Edit: the text is corrected in place and marked «معدّلة».
    const mine = page.getByRole("list", { name: "سجل الرسائل" });
    const first = mine.getByRole("listitem").filter({ hasText: "Kick-off at 8" });
    await first.getByRole("button", { name: "خيارات الرسالة" }).click();
    await page.getByRole("dialog", { name: "خيارات الرسالة" }).getByRole("button", { name: "تعديل" }).click();
    const box = page.getByRole("textbox", { name: "نص الرسالة" });
    await expect(box).toHaveValue("Kick-off at 8");
    await box.fill("Kick-off at 9");
    await page.getByRole("button", { name: "حفظ" }).click();
    const edited = mine.getByRole("listitem").filter({ hasText: "Kick-off at 9" });
    await expect(edited).toContainText("معدّلة");
    // The other member sees the edit without reloading.
    await expect(theirs.getByRole("listitem").filter({ hasText: "Kick-off at 9" })).toContainText("معدّلة");
    await expect(theirs.getByText("Kick-off at 8")).toHaveCount(0);

    // Delete: asked first, then «رسالة محذوفة» for both.
    await mine.getByRole("listitem").filter({ hasText: "Wrong chat, sorry" }).getByRole("button", { name: "خيارات الرسالة" }).click();
    await page.getByRole("dialog", { name: "خيارات الرسالة" }).getByRole("button", { name: "حذف" }).click();
    const confirm = page.getByRole("dialog", { name: "حذف الرسالة؟" });
    await confirm.getByRole("button", { name: "حذف" }).click();
    await expect(mine.getByText("Wrong chat, sorry")).toHaveCount(0);
    await expect(mine.getByText("رسالة محذوفة")).toBeVisible();
    await expect(theirs.getByText("Wrong chat, sorry")).toHaveCount(0);
    await expect(theirs.getByText("رسالة محذوفة")).toBeVisible();

    // The conversations list says so too.
    await other.goto("/ar/messages");
    await expect(other.getByText("رسالة محذوفة")).toBeVisible();
    await expect(other.getByText("[deleted]")).toHaveCount(0);

    // And it stays that way after reloading.
    await page.reload();
    await expect(page.getByRole("list", { name: "سجل الرسائل" }).getByRole("listitem").filter({ hasText: "Kick-off at 9" })).toContainText("معدّلة");
    await expect(page.getByText("رسالة محذوفة")).toBeVisible();
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
