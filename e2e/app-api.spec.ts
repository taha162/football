import { admin, createAuthUser, emailedCode, expect, PASSWORD, rpc, test, whatsappMessage } from "./fixtures";

/** The native app's endpoints (native/): where the database is, signing in, and deleting the account. */
test.describe("Native app endpoints", () => {
  test("the app learns where the database is (public values only)", async ({ request }) => {
    const res = await request.get("/api/app/config");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.supabaseUrl).toBe(process.env.NEXT_PUBLIC_SUPABASE_URL);
    expect(body.supabaseAnonKey).toBe(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
    expect(JSON.stringify(body)).not.toContain(process.env.SUPABASE_SERVICE_ROLE_KEY!);
  });

  test("signing in goes through the site's limits; the session then reads the member's own data", async ({ request }) => {
    const me = await createAuthUser("App player");
    const wrong = await request.post("/api/app/sign-in", { data: { email: me.email, password: "not-my-password" } });
    expect(wrong.status()).toBe(400);
    expect((await wrong.json()).error).toBe("invalid_credentials");
    expect((await (await request.post("/api/app/sign-in", { data: { email: "not-an-email", password: "x" } })).json()).field).toEqual({ name: "email", error: "invalid_email" });

    const ok = await request.post("/api/app/sign-in", { data: { email: me.email, password: PASSWORD } });
    expect(ok.status()).toBe(200);
    const session = await ok.json();
    expect(session).toMatchObject({ secondStep: false });
    expect(session.accessToken.length).toBeGreaterThan(20);
    const profile = await request.get(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/profiles?id=eq.${me.id}&select=display_name`, {
      headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, Authorization: `Bearer ${session.accessToken}` },
    });
    expect(await profile.json()).toEqual([{ display_name: me.name }]);
  });

  test("five wrong passwords stop the guessing, as on the site", async ({ request }) => {
    const me = await createAuthUser("Guessed");
    for (let i = 0; i < 5; i++) await request.post("/api/app/sign-in", { data: { email: me.email, password: `wrong-${i}` } });
    const blocked = await request.post("/api/app/sign-in", { data: { email: me.email, password: PASSWORD } });
    expect(blocked.status()).toBe(429);
    expect((await blocked.json()).error).toBe("too_many_attempts");
  });

  test("the member deletes their account from the app: the session, the word and the password", async ({ request }) => {
    const me = await createAuthUser("Leaves by app");
    expect((await request.post("/api/app/delete-account", { data: { confirm: "حذف", password: PASSWORD } })).status()).toBe(401);
    const { accessToken } = await (await request.post("/api/app/sign-in", { data: { email: me.email, password: PASSWORD } })).json();
    const headers = { Authorization: `Bearer ${accessToken}` };
    const noWord = await request.post("/api/app/delete-account", { headers, data: { confirm: "نعم", password: PASSWORD } });
    expect((await noWord.json()).field).toEqual({ name: "confirm", error: "delete_word" });
    const wrongPassword = await request.post("/api/app/delete-account", { headers, data: { confirm: "حذف", password: "nope-nope" } });
    expect((await wrongPassword.json()).field).toEqual({ name: "current_password", error: "wrong_password" });
    expect(await admin("select 1 from auth.users where id = $1", [me.id])).toHaveLength(1);

    const done = await request.post("/api/app/delete-account", { headers, data: { confirm: "حذف", password: PASSWORD, reason: "تجربة" } });
    expect(await done.json()).toEqual({ ok: true });
    expect(await admin("select 1 from auth.users where id = $1", [me.id])).toHaveLength(0);
  });
});

/** The native app's sign-up and password reset (server/signup-core.ts, shared with the site's pages). */
test.describe("Native app sign-up and reset", () => {
  const phone = () => `9647${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`;
  const username = () => `app_${Math.random().toString(36).slice(2, 10)}`;

  test("by e-mail: the code e-mailed opens the session, and the profile has the username", async ({ request }) => {
    const email = `app-${Math.random().toString(36).slice(2, 10)}@example.test`;
    const name = username();
    const start = await request.post("/api/app/sign-up", { data: { method: "email", display_name: "لاعب التطبيق", username: name, email, password: PASSWORD, accept_terms: true } });
    expect(await start.json()).toEqual({ next: "email_code", email });
    expect((await (await request.post("/api/app/email-code", { data: { email, code: "000000" } })).json()).error).toBe("invalid_code");
    const done = await (await request.post("/api/app/email-code", { data: { email, code: await emailedCode(email) } })).json();
    expect(done.next).toBe("onboarding");
    const me = await request.get(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/profiles?username=eq.${name}&select=display_name`, {
      headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, Authorization: `Bearer ${done.accessToken}` },
    });
    expect(await me.json()).toEqual([{ display_name: "لاعب التطبيق" }]);
  });

  test("the terms must be accepted, and a taken username is said on its field", async ({ request }) => {
    const res = await request.post("/api/app/sign-up", { data: { method: "email", display_name: "لاعب", username: username(), email: "x@example.test", password: PASSWORD } });
    expect((await res.json()).field).toEqual({ name: "accept_terms", error: "must_accept_terms" });
  });

  test("by WhatsApp: the code sent from the number opens the session", async ({ request, baseURL }) => {
    const number = phone();
    const start = await (await request.post("/api/app/sign-up", { data: { method: "whatsapp", display_name: "لاعب واتساب", username: username(), phone: `0${number.slice(3)}`, password: PASSWORD, accept_terms: true } })).json();
    expect(start).toMatchObject({ next: "whatsapp", botNumber: process.env.WHATSAPP_BOT_NUMBER });
    expect(start.link).toContain(encodeURIComponent(start.code));
    expect(await (await request.post("/api/app/whatsapp", { data: { ticket: start.ticket } })).json()).toEqual({ state: "pending" });
    expect((await whatsappMessage(baseURL!, number, start.code)).reply).toBeTruthy();
    const done = await (await request.post("/api/app/whatsapp", { data: { ticket: start.ticket } })).json();
    expect(done).toMatchObject({ state: "done", next: "onboarding" });
    expect(done.accessToken.length).toBeGreaterThan(20);
    // Once: the ticket is used up.
    expect(await (await request.post("/api/app/whatsapp", { data: { ticket: start.ticket } })).json()).toEqual({ state: "missing" });
  });

  test("a forgotten password by e-mail: the code, then a new password that signs in", async ({ request }) => {
    const me = await createAuthUser("Forgetful");
    expect(await (await request.post("/api/app/forgot", { data: { email: me.email } })).json()).toEqual({ next: "email_code" });
    const session = await (await request.post("/api/app/email-code", { data: { email: me.email, code: await emailedCode(me.email), purpose: "recovery" } })).json();
    expect(session.next).toBe("new_password");
    const mismatch = await (await request.post("/api/app/password", { data: { ...session, password: "New-pass-456", confirm: "other-pass-456" } })).json();
    expect(mismatch.field).toEqual({ name: "confirm", error: "passwords_mismatch" });
    expect(await (await request.post("/api/app/password", { data: { ...session, password: "New-pass-456", confirm: "New-pass-456" } })).json()).toEqual({ ok: true });
    expect((await request.post("/api/app/sign-in", { data: { email: me.email, password: "New-pass-456" } })).status()).toBe(200);
    expect((await request.post("/api/app/sign-in", { data: { email: me.email, password: PASSWORD } })).status()).toBe(400);
  });
});

/** An 8×8 lime PNG. */
const PHOTO = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAFUlEQVR42mPc8cmeARtgYsABBqcEAIHGAfltyicCAAAAAElFTkSuQmCC", "base64");

/** The app's pictures and attachments (server/avatar.ts and server/message-send.ts, shared with the site). */
test.describe("Native app files", () => {
  const signedIn = async (request: import("@playwright/test").APIRequestContext, email: string) => {
    const { accessToken } = await (await request.post("/api/app/sign-in", { data: { email, password: PASSWORD } })).json();
    return { Authorization: `Bearer ${accessToken}` };
  };

  test("the member's picture: checked by its bytes, stored in their folder, and the old one removed", async ({ request }) => {
    const me = await createAuthUser("App picture");
    expect((await request.post("/api/app/avatar", { multipart: { avatar: { name: "me.png", mimeType: "image/png", buffer: PHOTO } } })).status()).toBe(401);
    const headers = await signedIn(request, me.email);
    const fake = await request.post("/api/app/avatar", { headers, multipart: { avatar: { name: "me.png", mimeType: "image/png", buffer: Buffer.from("not a picture at all") } } });
    expect(fake.status()).toBe(400);
    expect(await admin("select avatar_path from public.profiles where id = $1", [me.id])).toEqual([{ avatar_path: null }]);

    const first = await (await request.post("/api/app/avatar", { headers, multipart: { avatar: { name: "me.png", mimeType: "image/png", buffer: PHOTO } } })).json();
    expect(first.path).toMatch(new RegExp(`^${me.id}/`));
    const second = await (await request.post("/api/app/avatar", { headers, multipart: { avatar: { name: "me.png", mimeType: "image/png", buffer: PHOTO } } })).json();
    expect(await admin("select avatar_path from public.profiles where id = $1", [me.id])).toEqual([{ avatar_path: second.path }]);
    const stored = await admin<{ name: string }>("select name from storage.objects where bucket_id = 'avatars' and name like $1", [`${me.id}/%`]);
    expect(stored.map((o) => o.name)).toEqual([second.path]);
  });

  test("a picture or a location in a conversation: only its members, and the file is checked", async ({ request }) => {
    const [me, friend, stranger] = [await createAuthUser("App sender"), await createAuthUser("App friend"), await createAuthUser("App stranger")];
    const conv = await rpc<string>(me.id, "start_direct_conversation", { p_user_id: friend.id });
    const headers = await signedIn(request, me.email);

    const picture = await request.post("/api/app/message", { headers, multipart: { conversation_id: conv, image: { name: "pitch.jpg", mimeType: "image/png", buffer: PHOTO } } });
    expect(picture.status()).toBe(200);
    const { id } = await picture.json();
    const [row] = await admin<{ image_path: string; sender_id: string }>("select image_path, sender_id from public.messages where id = $1", [id]);
    expect(row.sender_id).toBe(me.id);
    expect(row.image_path).toMatch(new RegExp(`^${conv}/`));

    const place = await request.post("/api/app/message", { headers, multipart: { conversation_id: conv, location_lat: "36.34", location_lng: "43.13", location_accuracy: "12" } });
    const [spot] = await admin<{ location_lat: number }>("select location_lat from public.messages where id = $1", [(await place.json()).id]);
    expect(Number(spot.location_lat)).toBeCloseTo(36.34, 2);

    expect((await request.post("/api/app/message", { headers, multipart: { conversation_id: conv, image: { name: "x.jpg", mimeType: "image/jpeg", buffer: Buffer.from("nope") } } })).status()).toBe(400);
    const outsider = await request.post("/api/app/message", { headers: await signedIn(request, stranger.email), multipart: { conversation_id: conv, image: { name: "pitch.png", mimeType: "image/png", buffer: PHOTO } } });
    expect((await outsider.json()).error).toBe("conversation_not_found");
    expect((await request.post("/api/app/message", { multipart: { conversation_id: conv, body: "hi" } })).status()).toBe(401);
  });
});
