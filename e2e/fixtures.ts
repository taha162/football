/**
 * E2E fixtures. Users are created through the Supabase Auth admin API (so
 * they can sign in through the real UI); domain fixtures that are not part of
 * the journey under test are created through the same RPCs the app uses,
 * executed as the relevant user.
 */
import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { admin, localTime, mosul, rpc } from "../tests/shared/db";
import { totp, wrongCode } from "../tests/shared/totp";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  // Well-known key of the local Supabase development stack (not a secret).
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  // Well-known key of the local Supabase development stack (not a secret).
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

export const PASSWORD = "Str0ng-pass-123";

export interface TestUser {
  id: string;
  email: string;
  name: string;
}

export async function createAuthUser(name: string, opts: { onboard?: boolean; admin?: boolean } = {}): Promise<TestUser> {
  const tag = randomUUID().slice(0, 8);
  const email = `e2e-${tag}@example.test`;
  const display = `${name} ${tag.slice(0, 4)}`;
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD, email_confirm: true, user_metadata: { display_name: display, locale: "ar" } }),
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
    await rpc(id, "update_my_preferences", { p_locale: "ar" });
  }
  if (opts.admin) await admin("insert into public.user_roles (user_id, role) values ($1, 'admin')", [id]);
  return { id, email, name: display };
}

export async function signIn(page: Page, user: TestUser) {
  await page.goto("/ar/sign-in");
  // "البريد الإلكتروني أو رقم الهاتف": accounts made with a phone number sign in with it.
  await page.getByRole("textbox", { name: /^البريد الإلكتروني/ }).fill(user.email);
  await page.getByRole("textbox", { name: "كلمة المرور" }).fill(PASSWORD);
  await page.getByRole("button", { name: "تسجيل الدخول" }).click();
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

const MAILPIT = process.env.E2E_MAILPIT_URL ?? "http://127.0.0.1:54324";

/** Latest numeric code e-mailed to `email` (local Mailpit inbox of the Supabase CLI stack). */
export async function emailedCode(email: string, timeoutMs = 15_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`);
    const list = (await res.json()) as { messages?: { ID: string }[] };
    const id = list.messages?.[0]?.ID;
    if (id) {
      const msg = (await (await fetch(`${MAILPIT}/api/v1/message/${id}`)).json()) as { Text?: string; HTML?: string };
      const match = /\b(\d{6,10})\b/.exec(msg.Text ?? "") ?? />(\d{6,10})</.exec(msg.HTML ?? "");
      if (match) return match[1];
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`no code e-mailed to ${email}`);
}

/** HTML of the latest e-mail sent to `email` (local Mailpit inbox). */
export async function emailedHtml(email: string, timeoutMs = 15_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`);
    const id = ((await res.json()) as { messages?: { ID: string }[] }).messages?.[0]?.ID;
    if (id) return ((await (await fetch(`${MAILPIT}/api/v1/message/${id}`)).json()) as { HTML?: string }).HTML ?? "";
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`no e-mail sent to ${email}`);
}

/** What the site answered the WhatsApp bot, with the HTTP status. */
export interface WhatsappReply {
  status: number;
  reply?: string;
}

/** Posts an incoming WhatsApp message to the site's webhook, as the bot (whatsapp-bot/) forwards it. */
export async function whatsappMessage(baseURL: string, from: string, text: string, secret = process.env.WHATSAPP_BOT_SECRET ?? ""): Promise<WhatsappReply> {
  const res = await fetch(`${baseURL}/api/whatsapp/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
    body: JSON.stringify({ from, text }),
  });
  const body = res.headers.get("content-type")?.includes("json") ? ((await res.json()) as { reply?: string }) : {};
  return { status: res.status, ...body };
}

/**
 * Signs in straight against the Supabase API with the password only, as
 * someone who knows the password but not the app code would (no browser).
 */
export async function passwordSession(user: TestUser): Promise<SupabaseClient> {
  const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await client.auth.signInWithPassword({ email: user.email, password: PASSWORD });
  if (error) throw error;
  return client;
}

/** Turns on two-step verification for `user` as their app would (enrol + first code); returns the secret. */
export async function turnOnSecondFactor(user: TestUser): Promise<string> {
  const client = await passwordSession(user);
  const { data, error } = await client.auth.mfa.enroll({ factorType: "totp" });
  if (error) throw error;
  const verified = await client.auth.mfa.challengeAndVerify({ factorId: data.id, code: totp(data.totp.secret) });
  if (verified.error) throw verified.error;
  return data.totp.secret;
}

export { admin, localTime, mosul, rpc, totp, wrongCode };

export { expect, test };
