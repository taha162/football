import { admin, createAuthUser, expect, PASSWORD, test } from "./fixtures";

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
