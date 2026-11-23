import { randomUUID } from "node:crypto";
import { admin, createAuthUser, expect, mosul, signIn, test } from "./fixtures";

/**
 * Cities, areas and public settings are read on every request, never kept
 * between requests (CHANGES.md item 112): a change made with SQL, not through
 * the admin panel, shows on the next page without waiting.
 */
test("an area added with SQL is offered on the next page", async ({ page }) => {
  const tag = randomUUID().slice(0, 6);
  const name = `حي التجربة ${tag}`;
  await signIn(page, await createAuthUser("Area"));
  await page.goto("/ar/profile");
  // The member lives in Mosul: the list holds Mosul's areas.
  const area = page.getByRole("combobox", { name: "الحي (عام، اختياري)" });
  await expect(area.locator("option", { hasText: name })).toHaveCount(0);

  const [{ id }] = await admin<{ id: string }>(
    "insert into public.areas (city_id, slug, name_en, name_ar) values ($1, $2, $3, $4) returning id",
    [await mosul(), `sql-test-${tag}`, `SQL test ${tag}`, name],
  );
  try {
    await page.reload();
    await expect(area.locator("option", { hasText: name })).toHaveCount(1);
  } finally {
    await admin("delete from public.areas where id = $1", [id]);
  }
});
