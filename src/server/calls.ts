"use server";

import { uuid } from "@/lib/actions";
import { createClient } from "@/lib/supabase/server";
import { iceServersForCall, STUN_SERVERS, type IceServer } from "@/lib/turn";

/**
 * Connection servers for a call the signed-in user is on (ringing or active).
 * TURN credentials are only handed out for such a call; anything else gets
 * the free STUN servers alone.
 */
export async function callIceServersAction(callId: string): Promise<IceServer[]> {
  if (!uuid.safeParse(callId).success) return STUN_SERVERS;
  const supabase = await createClient();
  // RLS: only the two people on the call can read it.
  const { data } = await supabase.from("calls").select("status").eq("id", callId).maybeSingle();
  if (!data || (data.status !== "ringing" && data.status !== "active")) return STUN_SERVERS;
  return iceServersForCall();
}
