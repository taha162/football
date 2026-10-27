/**
 * E2E fixtures. Users are created through the Supabase Auth admin API (so
 * they can sign in through the real UI); domain fixtures that are not part of
 * the journey under test are created through the same RPCs the app uses,
 * executed as the relevant user.
 */
import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { admin, localTime, mosul, rpc } from "../tests/shared/db";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  // Well-known key of the local Supabase development stack (not a secret).
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

export const PASSWORD = "Str0ng-pass-123";

export interface TestUser {
  id: string;
  email: string;
  name: string;
}

export async function createAuthUser(name: string, opts: { onboard?: boolean; admin?: boolean; locale?: "en" | "ar" } = {}): Promise<TestUser> {
  const tag = randomUUID().slice(0, 8);
  const email = `e2e-${tag}@example.test`;
  const display = `${name} ${tag.slice(0, 4)}`;
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD, email_confirm: true, user_metadata: { display_name: display, locale: opts.locale ?? "en" } }),
  });
  if (!res.ok) throw new Error(`createAuthUser failed: ${res.status} ${await res.text()}`);
  const { id } = (await res.json()) as { id: string };
  if (opts.onboard !== false) {
    await rpc(id, "update_my_profile", {
      p_display_name: display,
      p_city_id: await mosul(),
      p_positions: "{midfielder}",
      p_skill_level: "intermediate",
      p_complete_onboarding: true,
    });
    await rpc(id, "update_my_preferences", { p_locale: opts.locale ?? "en" });
  }
  if (opts.admin) await admin("insert into public.user_roles (user_id, role) values ($1, 'admin')", [id]);
  return { id, email, name: display };
}

export async function signIn(page: Page, user: TestUser, locale: "en" | "ar" = "en") {
  await page.goto(`/${locale}/sign-in`);
  await page.getByRole("textbox", { name: locale === "en" ? "Email" : "البريد الإلكتروني" }).fill(user.email);
  await page.getByRole("textbox", { name: locale === "en" ? "Password" : "كلمة المرور" }).fill(PASSWORD);
  await page.getByRole("button", { name: locale === "en" ? "Sign in" : "تسجيل الدخول" }).click();
  await page.waitForURL(/\/dashboard/);
}

export async function createMatchFor(organizer: TestUser, extra: Record<string, unknown> = {}) {
  return rpc<string>(organizer.id, "create_match", {
    p_title: `E2E match ${randomUUID().slice(0, 6)}`,
    p_city_id: await mosul(),
    p_start_local: localTime(2, 20),
    p_duration_minutes: 90,
    p_format: "5v5",
    p_total_players: 10,
    p_organizer_plays: false,
    ...extra,
  });
}

export { admin, localTime, mosul, rpc };

export { expect, test };
