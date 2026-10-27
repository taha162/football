import { randomUUID } from "node:crypto";
import { createAuthUser, createMatchFor, expect, signIn, test } from "./fixtures";

test.describe("Journey I — reporting and moderation", () => {
  test("a user reports a match, an administrator hides it and resolves the report", async ({ browser }) => {
    test.setTimeout(120_000);
    const organizer = await createAuthUser("Organizer");
    const reporter = await createAuthUser("Reporter");
    const moderator = await createAuthUser("Admin", { admin: true });
    const title = `Suspicious ${randomUUID().slice(0, 6)}`;
    const matchId = await createMatchFor(organizer, { p_title: title });
    const details = `Spam listing ${randomUUID().slice(0, 6)}`;

    const repCtx = await browser.newContext();
    const rep = await repCtx.newPage();
    await signIn(rep, reporter);
    await rep.goto(`/en/matches/${matchId}`);
    await rep.getByRole("button", { name: "Report" }).click();
    const dialog = rep.getByRole("dialog", { name: "Report a problem" });
    await dialog.getByRole("combobox", { name: "What's wrong?" }).selectOption("spam");
    await dialog.getByRole("textbox", { name: "Details (optional)" }).fill(details);
    await dialog.getByRole("button", { name: "Send report" }).click();
    await expect(dialog.getByText("Thanks. Our moderators will review your report.")).toBeVisible();

    const adminCtx = await browser.newContext();
    const adm = await adminCtx.newPage();
    await signIn(adm, moderator);
    await adm.goto("/en/admin/reports");
    const card = adm.getByRole("listitem").filter({ hasText: details });
    await expect(card).toBeVisible();
    await expect(card).toContainText(reporter.name);

    await card.getByRole("button", { name: "Hide content" }).click();
    const confirm = adm.getByRole("dialog", { name: "Hide content" });
    await confirm.getByRole("textbox").fill("Spam listing confirmed");
    await confirm.getByRole("button", { name: "Hide content" }).click();

    const card2 = adm.getByRole("listitem").filter({ hasText: details });
    await card2.getByRole("combobox", { name: "Report status" }).selectOption("resolved");
    await card2.getByRole("textbox", { name: "Resolution note" }).fill("Hidden for spam");
    await card2.getByRole("button", { name: "Update" }).click();
    await expect(adm.getByRole("listitem").filter({ hasText: details })).toHaveCount(0);
    await adm.goto("/en/admin/reports?status=resolved");
    await expect(adm.getByRole("listitem").filter({ hasText: details })).toBeVisible();

    // The match is no longer visible to other users; the action is in the audit log.
    await rep.goto(`/en/matches/${matchId}`);
    await expect(rep.getByRole("heading", { name: "Page not found" })).toBeVisible();
    await adm.goto("/en/admin/audit");
    await expect(adm.getByText("Spam listing confirmed").first()).toBeVisible();

    await Promise.all([repCtx.close(), adminCtx.close()]);
  });

  test("a regular user cannot reach the admin area", async ({ page }) => {
    const user = await createAuthUser("Regular");
    await signIn(page, user);
    for (const path of ["/en/admin", "/en/admin/users", "/en/admin/reports"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/en\/dashboard/);
    }
  });
});
