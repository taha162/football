import { createAuthUser, expect, mosul, rpc, signIn, test } from "./fixtures";

test.describe("Journey D — team creation, invitation and recruitment", () => {
  test("a captain creates a team, invites a member who accepts, and publishes recruitment", async ({ browser }) => {
    const captain = await createAuthUser("Captain");
    const member = await createAuthUser("Member");
    const teamName = `Lions ${Date.now() % 100000}`;

    const capCtx = await browser.newContext();
    const page = await capCtx.newPage();
    await signIn(page, captain);
    await page.goto("/ar/teams/new");
    await page.getByRole("textbox", { name: "اسم الفريق" }).fill(teamName);
    await page.getByRole("button", { name: "إنشاء الفريق" }).click();
    await page.waitForURL(/\/ar\/teams\/[0-9a-f-]{36}\/manage/);
    const teamId = page.url().split("/").at(-2)!;

    await page.getByPlaceholder("ابحث عن لاعبين بالاسم").fill(member.name);
    await page.getByRole("button", { name: "بحث", exact: true }).click();
    await page.getByRole("listitem").filter({ hasText: member.name }).getByRole("button", { name: "دعوة" }).click();
    await expect(page.getByText(`${member.name} — مدعو`)).toBeVisible();

    await page.getByRole("textbox", { name: "عنوان الإعلان" }).fill("Goalkeeper wanted");
    await page.getByText("حارس مرمى", { exact: true }).first().click();
    await page.getByRole("button", { name: "نشر الإعلان" }).click();
    await expect(page.getByText("Goalkeeper wanted")).toBeVisible();

    const memCtx = await browser.newContext();
    const memberPage = await memCtx.newPage();
    await signIn(memberPage, member);
    await expect(memberPage.getByText("أنت مدعو للانضمام إلى")).toBeVisible();
    await memberPage.getByRole("button", { name: "قبول" }).click();
    await memberPage.goto(`/ar/teams/${teamId}`);
    await expect(memberPage.getByRole("link", { name: member.name })).toBeVisible();
    await expect(memberPage.getByRole("button", { name: "مغادرة الفريق" })).toBeVisible();

    await memberPage.goto("/ar/recruitment?position=goalkeeper");
    await expect(memberPage.getByRole("heading", { name: "Goalkeeper wanted" }).first()).toBeVisible();
    await capCtx.close();
    await memCtx.close();
  });
});

test.describe("Journey E — two teams arrange a match", () => {
  test("a team publishes an opponent request, another challenges, and the challenge is accepted", async ({ browser }) => {
    const capA = await createAuthUser("CapA");
    const capB = await createAuthUser("CapB");
    const city = await mosul();
    const teamA = await rpc<string>(capA.id, "create_team", { p_name: `Home FC ${Date.now() % 100000}`, p_city_id: city });
    const teamB = await rpc<string>(capB.id, "create_team", { p_name: `Away FC ${Date.now() % 100000}`, p_city_id: city });

    const ctxA = await browser.newContext();
    const pageA = await ctxA.newPage();
    await signIn(pageA, capA);
    await pageA.goto(`/ar/opponents?team=${teamA}`);
    const publishForm = pageA.locator("form").filter({ has: pageA.getByRole("button", { name: "نشر الطلب" }) });
    await publishForm.getByRole("textbox", { name: "القواعد / ملاحظات" }).fill(`E2E request ${teamA.slice(0, 6)}`);
    await publishForm.getByRole("button", { name: "نشر الطلب" }).click();
    await expect(pageA.getByText("تم نشر طلب المنافس.")).toBeVisible();

    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();
    await signIn(pageB, capB);
    await pageB.goto(`/ar/opponents?team=${teamB}`);
    const card = pageB.locator("div").filter({ hasText: `E2E request ${teamA.slice(0, 6)}` }).filter({ has: pageB.getByText("أرسل تحدياً") }).last();
    await card.getByText("أرسل تحدياً").click();
    await card.getByRole("textbox", { name: "رسالة" }).fill("Thursday works for us");
    await card.getByRole("button", { name: "إرسال التحدي" }).click();
    await expect(pageB.getByText("تم إرسال التحدي.")).toBeVisible();

    await pageA.reload();
    const incoming = pageA.getByRole("listitem").filter({ hasText: "Thursday works for us" });
    await expect(incoming).toBeVisible();
    await incoming.getByRole("button", { name: "قبول وجدولة" }).click();
    await pageA.waitForURL(/\/ar\/matches\/[0-9a-f-]{36}$/);
    await expect(pageA.getByText("فريق ضد فريق").first()).toBeVisible();

    // The other captain sees the fixture and can join on their side.
    await pageB.goto(pageA.url().replace(/^https?:\/\/[^/]+/, ""));
    await pageB.getByRole("button", { name: "انضم للمباراة" }).click();
    await expect(pageB.getByText("أنت مسجل", { exact: true })).toBeVisible();
    await ctxA.close();
    await ctxB.close();
      });
});
