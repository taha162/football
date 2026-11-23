import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { admin, asUser, createUser, errorOf, rpc } from "./helpers";

/** An account as sign-up makes it, with the username typed on the form. */
async function signUpWith(username: string | null): Promise<string> {
  const id = randomUUID();
  await admin(
    `insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
     values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '', now(), $3, '{"provider":"email","providers":["email"]}', now(), now())`,
    [id, `u-${id.slice(0, 8)}@test.local`, JSON.stringify({ display_name: "Username test", ...(username ? { username } : {}) })],
  );
  return id;
}
const usernameOf = async (id: string) => (await admin<{ username: string }>("select username from public.profiles where id = $1", [id]))[0].username;
const fresh = () => `u${randomUUID().replace(/-/g, "").slice(0, 10)}`;

/** Migration 0041: usernames, one per member, unlike any other. */
describe("usernames", () => {
  it("a new account gets the username typed at sign-up, in lower case", async () => {
    const wished = fresh();
    const id = await signUpWith(wished.toUpperCase());
    expect(await usernameOf(id)).toBe(wished);
  });

  it("a taken, invalid or reserved one gives «player» and part of the account number instead", async () => {
    const wished = fresh();
    await signUpWith(wished);
    for (const name of [wished, "ab", "1abc", "ali..x", "ali.", "admin", "حسين"]) {
      const id = await signUpWith(name);
      expect(await usernameOf(id)).toBe(`player${id.replace(/-/g, "").slice(0, 6)}`);
    }
    // And without one at all.
    const none = await signUpWith(null);
    expect(await usernameOf(none)).toMatch(/^player[0-9a-f]{6}$/);
  });

  it("filling in members who joined before takes the username they typed, if still free", async () => {
    const someone = randomUUID();
    const pick = async (wished: string | null) => (await admin<{ u: string }>("select private.free_username($1, $2) as u", [someone, wished]))[0].u;
    const wished = fresh();
    expect(await pick(wished)).toBe(wished);
    const taken = await usernameOf(await createUser("Username holder"));
    expect(await pick(taken)).toBe(`player${someone.replace(/-/g, "").slice(0, 6)}`);
    expect(await pick(null)).toBe(`player${someone.replace(/-/g, "").slice(0, 6)}`);
  });

  it("says whether a username is free, to anyone", async () => {
    const me = await createUser("Username asker");
    const mine = await usernameOf(me);
    expect(await rpc(null, "username_available", { p_username: fresh() })).toBe("ok");
    expect(await rpc(null, "username_available", { p_username: mine })).toBe("taken");
    expect(await rpc(null, "username_available", { p_username: mine.toUpperCase() })).toBe("taken");
    expect(await rpc(null, "username_available", { p_username: "x" })).toBe("invalid");
    expect(await rpc(null, "username_available", { p_username: "support" })).toBe("invalid");
    // One's own is free for oneself.
    expect(await rpc(me, "username_available", { p_username: mine })).toBe("ok");
  });

  it("a member changes theirs, never to one taken, up to 5 times a day", async () => {
    const [me, other] = [await createUser("Username me"), await createUser("Username other")];
    const wanted = fresh();
    expect(await rpc(me, "set_username", { p_username: `  ${wanted.toUpperCase()} ` })).toBe(wanted);
    expect(await usernameOf(me)).toBe(wanted);
    expect(await errorOf(rpc(other, "set_username", { p_username: wanted }))).toMatch(/username_taken/);
    expect(await errorOf(rpc(other, "set_username", { p_username: "bad name" }))).toMatch(/invalid_username/);
    for (let i = 0; i < 4; i++) await rpc(me, "set_username", { p_username: fresh() });
    expect(await errorOf(rpc(me, "set_username", { p_username: fresh() }))).toMatch(/rate_limited/);
    // Visitors can't change anyone's.
    expect(await errorOf(rpc(null, "set_username", { p_username: fresh() }))).toMatch(/permission denied/);
  });

  it("anyone can read usernames, and every member has one", async () => {
    const me = await createUser("Username reader");
    const rows = await asUser<{ username: string }>(null, "select username from public.profiles where id = $1", [me]);
    expect(rows[0].username).toMatch(/^player[0-9a-f]{6,14}$/);
    expect((await admin<{ n: string }>("select count(*)::text as n from public.profiles where username is null"))[0].n).toBe("0");
  });

  it("a profile made outside sign-up (by hand in SQL) gets one made up", async () => {
    const id = await signUpWith(null);
    await admin("delete from public.profiles where id = $1", [id]);
    await admin("insert into public.profiles (id, display_name) values ($1, 'By hand')", [id]);
    expect(await usernameOf(id)).toMatch(/^player[0-9a-f]{6,14}$/);
  });
});
