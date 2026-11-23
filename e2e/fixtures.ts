/**
 * E2E fixtures. Users are created through the Supabase Auth admin API (so
 * they can sign in through the real UI); domain fixtures that are not part of
 * the journey under test are created through the same RPCs the app uses,
 * executed as the relevant user.
 */
import { randomUUID } from "node:crypto";
import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
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

/** A username nobody has: the sign-up forms ask for one (migration 0041). */
export const newUsername = () => `fan_${randomUUID().replace(/-/g, "").slice(0, 12)}`;

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
  // The WhatsApp number comes first; test users have an e-mail, the other way in.
  await page.goto("/ar/sign-in?method=email");
  await page.getByRole("textbox", { name: "البريد الإلكتروني" }).fill(user.email);
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

/**
 * Puts a photo as phones take them into a file input: 3000×2250 of noise
 * (which doesn't compress), so the JPEG is bigger than the 4.5 MB the host
 * accepts in one request. Taken upright, it is stored as phones store it: on
 * its side, with an EXIF tag (orientation 6) to turn it a quarter clockwise,
 * so it shows 2250 wide and 3000 tall. Returns its size in bytes.
 */
export async function choosePhonePhoto(input: Locator): Promise<number> {
  return input.evaluate(async (el) => {
    const canvas = document.createElement("canvas");
    canvas.width = 3000;
    canvas.height = 2250;
    const ctx = canvas.getContext("2d")!;
    const pixels = ctx.createImageData(canvas.width, canvas.height);
    const words = new Uint32Array(pixels.data.buffer);
    for (let i = 0; i < words.length; i++) words[i] = ((Math.random() * 0x1000000) | 0) | 0xff000000;
    ctx.putImageData(pixels, 0, 0);
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), "image/jpeg", 0.95));
    const jpeg = new Uint8Array(await blob.arrayBuffer());
    // APP1 "Exif\0\0": a big-endian TIFF header, then one tag, Orientation (0x0112) = 6.
    const exif = new Uint8Array([
      0xff, 0xe1, 0x00, 0x22, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00,
      0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08,
      0x00, 0x01, 0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, 0x06, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00,
    ]);
    const photo = new File([jpeg.slice(0, 2), exif, jpeg.slice(2)], "IMG_0001.jpg", { type: "image/jpeg" });
    const list = new DataTransfer();
    list.items.add(photo);
    (el as HTMLInputElement).files = list.files;
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return photo.size;
  });
}

/** Width and height of a picture in a public storage bucket ("bucket/path"), as the page shows it. */
export async function storedPictureSize(page: Page, object: string): Promise<{ width: number; height: number }> {
  return page.evaluate(async (src) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    return { width: img.naturalWidth, height: img.naturalHeight };
  }, `${SUPABASE_URL}/storage/v1/object/public/${object}`);
}

/**
 * A visitor address for per-device limits (sent as x-real-ip), from the IPv6
 * documentation range: about four billion of them, so one run never lands on
 * an address an earlier run already counted (those counts last up to an hour).
 */
export function testAddress(): string {
  const hex = randomUUID().replace(/-/g, "");
  return `2001:db8:${hex.slice(0, 4)}:${hex.slice(4, 8)}::1`;
}

/**
 * The WhatsApp waiting page opens wa.me by itself in a new tab: answered here,
 * so no test reaches WhatsApp's site.
 */
export async function quietWhatsapp(context: BrowserContext) {
  await context.route("https://wa.me/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<title>WhatsApp</title>" }));
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
