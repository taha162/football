import { NextResponse, type NextRequest } from "next/server";
import { appMember } from "@/lib/supabase/app-token";
import { uploadAvatar } from "@/server/avatar";

export const dynamic = "force-dynamic";

/** The phone app: the member's new picture (the same checks as the site's, server/avatar.ts). */
export async function POST(request: NextRequest) {
  const member = await appMember(request);
  if (!member) return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  const form = await request.formData().catch(() => null);
  const file = form?.get("avatar");
  if (!(file instanceof File)) return NextResponse.json({ error: "file_missing" }, { status: 400 });
  const { data: profile } = await member.supabase.from("profiles").select("avatar_path").eq("id", member.user.id).maybeSingle();
  const result = await uploadAvatar(member.supabase, { id: member.user.id, avatarPath: profile?.avatar_path ?? null }, file);
  return result.ok ? NextResponse.json({ ok: true, path: result.path }) : NextResponse.json({ error: result.code }, { status: 400 });
}
