/**
 * Operator-only bootstrap: grants the platform "admin" (or "moderator") role
 * to an existing account. There is intentionally no way to do this from the
 * app itself; after the first admin exists, roles are managed in /admin/users
 * (which is audited).
 *
 * Usage (reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from the
 * environment, e.g. `set -a; . ./.env.local; set +a`):
 *   pnpm admin:grant someone@example.com [admin|moderator]
 */
import { createClient } from "@supabase/supabase-js";

async function main() {
  const [email, role = "admin"] = process.argv.slice(2);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!email || !["admin", "moderator"].includes(role)) {
    console.error("Usage: pnpm admin:grant <email> [admin|moderator]");
    process.exit(2);
  }
  if (!url || !key) {
    console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in the environment.");
    process.exit(2);
  }
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  let userId: string | undefined;
  for (let page = 1; !userId; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    userId = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())?.id;
    if (data.users.length < 1000) break;
  }
  if (!userId) {
    console.error(`No account found for ${email}. The person must sign up first.`);
    process.exit(1);
  }

  const { error } = await supabase.from("user_roles").upsert({ user_id: userId, role }, { onConflict: "user_id,role", ignoreDuplicates: true });
  if (error) throw error;
  const { error: auditError } = await supabase
    .from("audit_logs")
    .insert({ actor_id: null, action: "role_granted_by_operator", entity_type: "user", entity_id: userId, details: { role } });
  if (auditError) throw auditError;
  console.log(`Granted ${role} to ${email} (${userId}).`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
