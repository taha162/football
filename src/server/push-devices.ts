"use server";

import { cookies } from "next/headers";
import { logger } from "@/lib/log";
import { PUSH_TOKEN_COOKIE } from "@/lib/push/device-cookie";
import { createClient } from "@/lib/supabase/server";

/**
 * The phone app (components/layout/native-push.tsx), after sign-in: this phone
 * receives this member's notifications (migration 0051). Who the member is
 * comes from the session, never from the page.
 */
export async function registerPushDeviceAction(token: string, platform: string): Promise<void> {
  if (typeof token !== "string" || token.length < 20 || token.length > 4096 || (platform !== "android" && platform !== "ios")) return;
  const supabase = await createClient();
  const { error } = await supabase.rpc("register_push_device", { p_token: token, p_platform: platform });
  if (error) {
    // Before migration 0051 the function is missing: the phone simply gets no notifications yet.
    if (error.code !== "PGRST202") logger.warn("push_register_failed", { code: error.code });
    return;
  }
  (await cookies()).set(PUSH_TOKEN_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}
