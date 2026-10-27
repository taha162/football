import { createAuthUser, expect, mosul, rpc, signIn, test } from "./fixtures";

test.describe("Journey D — team creation, invitation and recruitment", () => {
  test("a captain creates a team, invites a member who accepts, and publishes recruitment", async ({ browser }) => {
    const captain = await createAuthUser("Captain");
    const member = await createAuthUser("Member");
    const teamName = `Lions ${Date.now() % 100000}`;

    const capCtx = await browser.newContext();
    const page = await capCtx.newPage();
    await signIn(page, captain);
    await page.goto("/en/teams/new");
    await page.getByRole("textbox", { name: "Team name" }).fill(teamName);
    await page.getByRole("button", { name: "Create team" }).click();
    await page.waitForURL(/\/en\/teams\/[0-9a-f-]{36}\/manage/);
    const teamId = page.url().split("/").at(-2)!;

    await page.getByPlaceholder("Search players by name").fill(member.name);
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await page.getByRole("listitem").filter({ hasText: member.name }).getByRole("button", { name: "Invite" }).click();
    await expect(page.getByText(`${member.name} — invited`)).toBeVisible();

    await page.getByRole("textbox", { name: "Listing title" }).fill("Goalkeeper wanted");
    await page.getByText("Goalkeeper", { exact: true }).first().click();
    await page.getByRole("button", { name: "Publish listing" }).click();
    await expect(page.getByText("Goalkeeper wanted")).toBeVisible();

    const memCtx = await browser.newContext();
    const memberPage = await memCtx.newPage();
    await signIn(memberPage, member);
    await expect(memberPage.getByText("You're invited to join")).toBeVisible();
    await memberPage.getByRole("button", { name: "Accept" }).click();
    await memberPage.goto(`/en/teams/${teamId}`);
    await expect(memberPage.getByRole("link", { name: member.name })).toBeVisible();
    await expect(memberPage.getByRole("button", { name: "Leave team" })).toBeVisible();

    await memberPage.goto("/en/recruitment?position=goalkeeper");
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
    await pageA.goto(`/en/opponents?team=${teamA}`);
    const publishForm = pageA.locator("form").filter({ has: pageA.getByRole("button", { name: "Publish request" }) });
    await publishForm.getByRole("textbox", { name: "Rules / notes" }).fill(`E2E request ${teamA.slice(0, 6)}`);
    await publishForm.getByRole("button", { name: "Publish request" }).click();
    await expect(pageA.getByText("Opponent request published.")).toBeVisible();

    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();
    await signIn(pageB, capB);
    await pageB.goto(`/en/opponents?team=${teamB}`);
    const card = pageB.locator("div").filter({ hasText: `E2E request ${teamA.slice(0, 6)}` }).filter({ has: pageB.getByText("Send a challenge") }).last();
    await card.getByText("Send a challenge").click();
    await card.getByRole("textbox", { name: "Message" }).fill("Thursday works for us");
    await card.getByRole("button", { name: "Send challenge" }).click();
    await expect(pageB.getByText("Challenge sent.")).toBeVisible();

    await pageA.reload();
    const incoming = pageA.getByRole("listitem").filter({ hasText: "Thursday works for us" });
    await expect(incoming).toBeVisible();
    await incoming.getByRole("button", { name: "Accept & schedule" }).click();
    await pageA.waitForURL(/\/en\/matches\/[0-9a-f-]{36}$/);
    await expect(pageA.getByText("Team vs team").first()).toBeVisible();

    // The other captain sees the fixture and can join on their side.
    await pageB.goto(pageA.url().replace(/^https?:\/\/[^/]+/, ""));
    await pageB.getByRole("button", { name: "Join match" }).click();
    await expect(pageB.getByText("You're in", { exact: true })).toBeVisible();
    await ctxA.close();
    await ctxB.close();
      });
});
