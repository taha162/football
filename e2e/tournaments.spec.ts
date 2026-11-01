import { randomUUID } from "node:crypto";
import { createAuthUser, expect, mosul, rpc, signIn, test } from "./fixtures";

test.describe("Journey H — tournament lifecycle", () => {
  test("an organizer runs a league: registration, approval, fixtures, results and standings", async ({ browser }) => {
    test.setTimeout(180_000);
    const organizer = await createAuthUser("Organizer");
    const captains = await Promise.all([createAuthUser("CapOne"), createAuthUser("CapTwo"), createAuthUser("CapThree")]);
    const city = await mosul();
    const tag = randomUUID().slice(0, 5);
    const teamNames = captains.map((_, i) => `T${i + 1} ${tag}`);
    const teamIds = await Promise.all(captains.map((c, i) => rpc<string>(c.id, "create_team", { p_name: teamNames[i], p_city_id: city })));
    const name = `E2E Cup ${tag}`;

    const orgCtx = await browser.newContext();
    const org = await orgCtx.newPage();
    await signIn(org, organizer);
    await org.goto("/ar/tournaments/new");
    await org.getByRole("textbox", { name: "الاسم" }).fill(name);
    await org.getByRole("combobox", { name: "نظام البطولة" }).selectOption("round_robin");
    await org.getByRole("spinbutton", { name: "الحد الأقصى للفرق" }).fill("4");
    await org.getByRole("spinbutton", { name: "أقل عدد أعضاء للفريق" }).fill("1");
    await org.getByRole("button", { name: "إنشاء البطولة" }).click();
    await org.waitForURL(/\/ar\/tournaments\/[0-9a-f-]{36}\/manage/);
    const tournamentId = org.url().match(/tournaments\/([0-9a-f-]{36})/)![1];
    await org.getByRole("button", { name: "فتح التسجيل" }).click();
    await expect(org.getByRole("button", { name: "إغلاق التسجيل" })).toBeVisible();

    // One captain registers through the public page; the others through the same RPC.
    const capCtx = await browser.newContext();
    const cap = await capCtx.newPage();
    await signIn(cap, captains[0]);
    await cap.goto(`/ar/tournaments/${tournamentId}`);
    await cap.getByRole("combobox", { name: "الفريق" }).selectOption(teamIds[0]);
    await cap.getByRole("button", { name: "تسجيل", exact: true }).click();
    await expect(cap.getByText("بانتظار الموافقة").first()).toBeVisible();
    await rpc(captains[1].id, "register_tournament_team", { p_tournament_id: tournamentId, p_team_id: teamIds[1] });
    await rpc(captains[2].id, "register_tournament_team", { p_tournament_id: tournamentId, p_team_id: teamIds[2] });

    await org.reload();
    for (const team of teamNames) {
      const row = org.getByRole("listitem").filter({ hasText: team });
      await row.getByRole("button", { name: "قبول" }).click();
      await expect(org.getByRole("listitem").filter({ hasText: team }).getByText("مقبول")).toBeVisible();
    }
    await org.getByRole("button", { name: "إغلاق التسجيل" }).click();
    await org.getByRole("button", { name: "إنشاء المباريات لـ3 فريق" }).click();
    await expect(org.getByText("جارية").first()).toBeVisible();

    // Record the first fixture's result.
    await org.getByText("تسجيل النتيجة", { exact: true }).first().click();
    const homeInput = org.getByRole("spinbutton", { name: /^أهداف / }).first();
    const homeTeam = (await homeInput.getAttribute("aria-label"))!.replace("أهداف ", "");
    await homeInput.fill("3");
    await org.getByRole("spinbutton", { name: /^أهداف / }).nth(1).fill("1");
    await org.getByRole("button", { name: "حفظ", exact: true }).first().click();
    await expect(org.getByText("3 – 1", { exact: true }).first()).toBeVisible();

    // Public standings: the winner has 3 points and a +2 goal difference.
    await cap.goto(`/ar/tournaments/${tournamentId}`);
    const standing = cap.getByRole("row").filter({ hasText: homeTeam });
    await expect(standing.getByRole("cell").last()).toHaveText("3");
    await expect(standing).toContainText("+2");

    await Promise.all([orgCtx.close(), capCtx.close()]);
  });
});
