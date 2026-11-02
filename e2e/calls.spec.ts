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
