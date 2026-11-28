import { after, NextResponse, type NextRequest } from "next/server";
import { appFailure } from "@/lib/app-api";
import { appMember } from "@/lib/supabase/app-token";
import { sendMessage } from "@/server/message-send";
import { drainPush, pushEnabled } from "@/server/push";

export const dynamic = "force-dynamic";

/**
 * The phone app sends a message with a picture or a voice note here (text
 * alone goes straight to the database): the same checks as the site's
 * (server/message-send.ts), as the member whose token comes with it.
 */
export async function POST(request: NextRequest) {
  const member = await appMember(request);
  if (!member) return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  const form = await request.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const result = await sendMessage(member.supabase, form);
  if (!result.ok) return appFailure(result);
  if (pushEnabled()) after(() => drainPush().then(() => undefined));
  return NextResponse.json({ ok: true, id: result.id });
}
