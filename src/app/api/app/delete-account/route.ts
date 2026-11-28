import { NextResponse, type NextRequest } from "next/server";
import { appMember } from "@/lib/supabase/app-token";
import { deleteOwnAccount } from "@/server/account-deletion";

export const dynamic = "force-dynamic";

/** The phone app: the member deletes their own account (the same steps as Settings → «حذف الحساب»). */
export async function POST(request: NextRequest) {
  const member = await appMember(request);
  if (!member?.user.email) return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const text = (key: string) => (typeof body?.[key] === "string" ? (body[key] as string) : "");
  const result = await deleteOwnAccount(member.supabase, { id: member.user.id, email: member.user.email }, {
    confirm: text("confirm"),
    password: text("password"),
    reason: text("reason"),
  });
  if (!result.ok) return NextResponse.json({ error: result.code, field: result.field ?? null }, { status: 400 });
  return NextResponse.json({ ok: true });
}
