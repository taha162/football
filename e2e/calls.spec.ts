import type { Page } from "@playwright/test";
import { createAuthUser, expect, rpc, signIn, test } from "./fixtures";

/** The call screen (a dialog named after the other person). */
const callScreen = (page: Page, name: string) => page.getByRole("dialog", { name });
const TALKING = /^[٠-٩]+:[٠-٩]{2}$/;

test.describe("Voice calls", () => {
  test("a call rings on any page, connects the two browsers, and is recorded in the conversation", async ({ page, browser }) => {
    const [caller, callee] = [await createAuthUser("Caller"), await createAuthUser("Callee")];
    const conv = await rpc<string>(caller.id, "start_direct_conversation", { p_user_id: callee.id });

    // The person called is somewhere else on the site.
    const other = await (await browser.newContext()).newPage();
    await signIn(other, callee);
    await other.goto("/ar/venues");
    await other.waitForLoadState("networkidle");

    await signIn(page, caller);
    await page.goto(`/ar/messages/${conv}`);
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "اتصال" }).click();
    const outgoing = callScreen(page, callee.name);
    await expect(outgoing.getByRole("status")).toHaveText("يرن…");

    const incoming = callScreen(other, caller.name);
    await expect(incoming.getByText("مكالمة صوتية واردة")).toBeVisible();
    await incoming.getByRole("button", { name: "رد" }).click();

    // Connected: both screens show the call's clock.
    await expect(outgoing.getByRole("status")).toHaveText(TALKING, { timeout: 30_000 });
    await expect(incoming.getByRole("status")).toHaveText(TALKING, { timeout: 30_000 });
    // The other person's voice is really arriving.
    await expect
      .poll(() => other.evaluate(() => (document.querySelector("audio[autoplay]") as HTMLAudioElement | null)?.srcObject instanceof MediaStream), { timeout: 10_000 })
      .toBe(true);

    // Mute is a toggle.
    await outgoing.getByRole("button", { name: "كتم" }).click();
    await expect(outgoing.getByRole("button", { name: "إلغاء الكتم" })).toHaveAttribute("aria-pressed", "true");

    // The caller can shrink the call and keep using the site.
    await outgoing.getByRole("button", { name: "تصغير المكالمة" }).click();
    await expect(page.getByRole("region", { name: "مكالمة جارية" })).toBeVisible();
    await page.getByRole("button", { name: "عرض المكالمة" }).click();

    await page.waitForTimeout(1500);
    await callScreen(page, callee.name).getByRole("button", { name: "إنهاء" }).click();
    await expect(callScreen(other, caller.name).getByRole("status")).toContainText("انتهت المكالمة", { timeout: 15_000 });
    await expect(callScreen(other, caller.name)).toBeHidden({ timeout: 10_000 });

    // The conversation records it, with its length.
    await other.goto(`/ar/messages/${conv}`);
    await expect(other.getByTestId("call-line")).toContainText(/مكالمة صوتية · [٠-٩]+:[٠-٩]{2}/);
    await other.context().close();
  });

  test("a call the caller cancels is a missed call for the person called, with a notification", async ({ page, browser }) => {
    const [caller, callee] = [await createAuthUser("Caller"), await createAuthUser("Callee")];
    const conv = await rpc<string>(caller.id, "start_direct_conversation", { p_user_id: callee.id });

    const other = await (await browser.newContext()).newPage();
    await signIn(other, callee);
    await other.waitForLoadState("networkidle");

    await signIn(page, caller);
    await page.goto(`/ar/messages/${conv}`);
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "اتصال" }).click();
    await expect(callScreen(page, callee.name).getByRole("status")).toHaveText("يرن…");
    await expect(callScreen(other, caller.name)).toBeVisible();
    await callScreen(page, callee.name).getByRole("button", { name: "إنهاء" }).click();
    // The ringing stops on the other side.
    await expect(callScreen(other, caller.name)).toBeHidden({ timeout: 15_000 });

    await other.goto("/ar/notifications");
    await expect(other.getByText(`مكالمة فائتة من ${caller.name}.`)).toBeVisible();
    await other.goto(`/ar/messages/${conv}`);
    await expect(other.getByTestId("call-line")).toContainText("مكالمة فائتة");
    await page.goto(`/ar/messages/${conv}`);
    await expect(page.getByTestId("call-line")).toContainText("مكالمة لم يُرَد عليها");
    await other.context().close();
  });

  test("a player's page has a call button; names in a conversation lead there", async ({ page, browser }) => {
    const [caller, callee] = [await createAuthUser("Caller"), await createAuthUser("Callee")];
    const other = await (await browser.newContext()).newPage();
    await signIn(other, callee);
    await other.waitForLoadState("networkidle");

    // No conversation yet: calling from the player's page opens it.
    await signIn(page, caller);
    await page.goto(`/ar/players/${callee.id}`);
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "اتصال" }).click();
    await expect(callScreen(page, callee.name).getByRole("status")).toHaveText("يرن…");
    await callScreen(other, caller.name).getByRole("button", { name: "رفض" }).click();
    await expect(callScreen(page, callee.name).getByRole("status")).toHaveText("لا يوجد رد", { timeout: 15_000 });

    // The call's record is in their direct conversation; the caller's name there opens the caller's page.
    await other.goto("/ar/messages");
    await expect(other.getByText("📞 مكالمة")).toBeVisible();
    await other.getByText("📞 مكالمة").click();
    await expect(other.getByTestId("call-line")).toContainText("مكالمة فائتة");
    await rpc(caller.id, "send_message", {
      p_conversation_id: other.url().split("/").pop(),
      p_body: "اتصل بي",
    });
    await other.reload();
    await other.getByRole("link", { name: caller.name }).click();
    await other.waitForURL(new RegExp(`/ar/players/${caller.id}$`));
    await expect(other.getByRole("button", { name: "اتصال" })).toBeVisible();
    await other.context().close();
  });

  test("on a phone that allows it, the speaker button switches between loudspeaker and earpiece", async ({ page, browser }) => {
    const [caller, callee] = [await createAuthUser("Caller"), await createAuthUser("Callee")];
    const conv = await rpc<string>(caller.id, "start_direct_conversation", { p_user_id: callee.id });

    // A phone listing the two outputs an iPhone shows during a call (Receiver and Speaker).
    const phone = await browser.newContext({ isMobile: true, hasTouch: true, viewport: { width: 390, height: 844 } });
    await phone.addInitScript(() => {
      const w = window as unknown as { __sinks: string[] };
      w.__sinks = [];
      const devices = navigator.mediaDevices;
      const real = devices.enumerateDevices.bind(devices);
      const output = (label: string, deviceId: string) => ({ kind: "audiooutput", label, deviceId, groupId: "", toJSON: () => ({}) }) as MediaDeviceInfo;
      devices.enumerateDevices = async () => [...(await real()).filter((d) => d.kind === "audioinput"), output("Receiver", "receiver"), output("Speaker", "speaker")];
      HTMLMediaElement.prototype.setSinkId = function (id: string) {
        w.__sinks.push(id);
        return Promise.resolve();
      };
    });
    const mobile = await phone.newPage();
    await signIn(mobile, caller);

    await signIn(page, callee);
    await page.waitForLoadState("networkidle");

    await mobile.goto(`/ar/messages/${conv}`);
    await mobile.waitForLoadState("networkidle");
    await mobile.getByRole("button", { name: "اتصال" }).click();
    await callScreen(page, caller.name).getByRole("button", { name: "رد" }).click();
    const screen = callScreen(mobile, callee.name);
    await expect(screen.getByRole("status")).toHaveText(TALKING, { timeout: 30_000 });

    // The call starts on the loudspeaker; the button moves it to the earpiece and back.
    const speaker = screen.getByRole("button", { name: "مكبر الصوت" });
    await expect(speaker).toHaveAttribute("aria-pressed", "true");
    const sinks = () => mobile.evaluate(() => (window as unknown as { __sinks: string[] }).__sinks.at(-1));
    expect(await sinks()).toBe("speaker");
    await speaker.click();
    await expect(speaker).toHaveAttribute("aria-pressed", "false");
    expect(await sinks()).toBe("receiver");
    await speaker.click();
    await expect(speaker).toHaveAttribute("aria-pressed", "true");
    expect(await sinks()).toBe("speaker");

    // A laptop offers no such choice: no button there.
    await expect(callScreen(page, caller.name).getByRole("button", { name: "مكبر الصوت" })).toHaveCount(0);
    await screen.getByRole("button", { name: "إنهاء" }).click();
    await phone.close();
  });

  test("iPhone: both sides get the speaker button, which switches Safari's audio session", async ({ browser }) => {
    const [caller, callee] = [await createAuthUser("Caller"), await createAuthUser("Callee")];
    const conv = await rpc<string>(caller.id, "start_direct_conversation", { p_user_id: callee.id });
    // Two iPhones: Safari's Audio Session API, and no output list.
    const iPhone = async () => {
      const ctx = await browser.newContext({ isMobile: true, hasTouch: true, viewport: { width: 390, height: 844 } });
      await ctx.addInitScript(() => {
        Object.defineProperty(navigator, "audioSession", { value: { type: "auto" }, configurable: true });
      });
      return ctx.newPage();
    };
    const sessionType = (p: Page) => p.evaluate(() => (navigator as Navigator & { audioSession: { type: string } }).audioSession.type);
    const [a, b] = [await iPhone(), await iPhone()];
    await signIn(a, caller);
    await signIn(b, callee);
    await b.waitForLoadState("networkidle");
    await a.goto(`/ar/messages/${conv}`);
    await a.waitForLoadState("networkidle");
    await a.getByRole("button", { name: "اتصال" }).click();
    await callScreen(b, caller.name).getByRole("button", { name: "رد" }).click();
    await expect(callScreen(a, callee.name).getByRole("status")).toHaveText(TALKING, { timeout: 30_000 });

    // The person called has the button too, starting on the loudspeaker.
    for (const [p, name] of [[a, callee.name], [b, caller.name]] as const) {
      await expect(callScreen(p, name).getByRole("button", { name: "مكبر الصوت" })).toHaveAttribute("aria-pressed", "true");
      expect(await sessionType(p)).toBe("auto");
    }
    const speaker = callScreen(b, caller.name).getByRole("button", { name: "مكبر الصوت" });
    await speaker.click();
    await expect(speaker).toHaveAttribute("aria-pressed", "false");
    expect(await sessionType(b)).toBe("play-and-record");
    await speaker.click();
    await expect(speaker).toHaveAttribute("aria-pressed", "true");
    expect(await sessionType(b)).toBe("auto");

    // Hanging up on the earpiece puts Safari's session back.
    await speaker.click();
    await callScreen(b, caller.name).getByRole("button", { name: "إنهاء" }).click();
    await expect.poll(() => sessionType(b)).toBe("auto");
    await Promise.all([a.context().close(), b.context().close()]);
  });

  test("Android: the speaker button reopens the microphone on Speakerphone or Headset earpiece, one at a time", async ({ page, browser }) => {
    const [caller, callee] = [await createAuthUser("Caller"), await createAuthUser("Callee")];
    const conv = await rpc<string>(caller.id, "start_direct_conversation", { p_user_id: callee.id });
    // An Android phone: Chrome names its microphones after where the sound plays, and opens one at a time.
    const phone = await browser.newContext({ isMobile: true, hasTouch: true, viewport: { width: 412, height: 915 } });
    await phone.addInitScript(() => {
      const w = window as unknown as { __requested: string[]; __openedWhileLive: boolean };
      w.__requested = [];
      w.__openedWhileLive = false;
      const devices = navigator.mediaDevices;
      const real = devices.getUserMedia.bind(devices);
      const tracks: MediaStreamTrack[] = [];
      devices.getUserMedia = async (c?: MediaStreamConstraints) => {
        if (tracks.some((t) => t.readyState === "live")) w.__openedWhileLive = true;
        const wanted = typeof c?.audio === "object" ? (c.audio.deviceId as { exact?: string } | undefined)?.exact : undefined;
        if (wanted) w.__requested.push(wanted);
        const stream = await real({ audio: true, video: false });
        tracks.push(...stream.getTracks());
        return stream;
      };
      const input = (label: string, deviceId: string) => ({ kind: "audioinput", label, deviceId, groupId: "", toJSON: () => ({}) }) as MediaDeviceInfo;
      devices.enumerateDevices = async () => [input("Speakerphone", "sp"), input("Headset earpiece", "ear")];
    });
    const mobile = await phone.newPage();
    await signIn(mobile, caller);
    await signIn(page, callee);
    await page.waitForLoadState("networkidle");
    await mobile.goto(`/ar/messages/${conv}`);
    await mobile.waitForLoadState("networkidle");
    await mobile.getByRole("button", { name: "اتصال" }).click();
    await callScreen(page, caller.name).getByRole("button", { name: "رد" }).click();
    const screen = callScreen(mobile, callee.name);
    await expect(screen.getByRole("status")).toHaveText(TALKING, { timeout: 30_000 });

    const speaker = screen.getByRole("button", { name: "مكبر الصوت" });
    await expect(speaker).toHaveAttribute("aria-pressed", "true");
    await speaker.click();
    await expect(speaker).toHaveAttribute("aria-pressed", "false");
    await speaker.click();
    await expect(speaker).toHaveAttribute("aria-pressed", "true");
    const seen = await mobile.evaluate(() => {
      const w = window as unknown as { __requested: string[]; __openedWhileLive: boolean };
      return { requested: w.__requested, openedWhileLive: w.__openedWhileLive };
    });
    expect(seen).toEqual({ requested: ["ear", "sp"], openedWhileLive: false });
    // The call carries on.
    await expect(screen.getByRole("status")).toHaveText(TALKING);
    await screen.getByRole("button", { name: "إنهاء" }).click();
    await phone.close();
  });

  test("declining ends the call for the caller as no answer", async ({ page, browser }) => {
    const [caller, callee] = [await createAuthUser("Caller"), await createAuthUser("Callee")];
    const conv = await rpc<string>(caller.id, "start_direct_conversation", { p_user_id: callee.id });
    const other = await (await browser.newContext()).newPage();
    await signIn(other, callee);
    await other.waitForLoadState("networkidle");
    await signIn(page, caller);
    await page.goto(`/ar/messages/${conv}`);
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "اتصال" }).click();
    await callScreen(other, caller.name).getByRole("button", { name: "رفض" }).click();
    await expect(callScreen(page, callee.name).getByRole("status")).toHaveText("لا يوجد رد", { timeout: 15_000 });
    await expect(callScreen(other, caller.name)).toBeHidden();
    await other.context().close();
  });
});
