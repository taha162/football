"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { getBrowserClient, getRealtimeClient } from "@/lib/supabase/client";

/**
 * Keeps the list of conversations up to date: a new message in one of the
 * listed conversations refreshes it (last message, time, unread count).
 * It listens to those conversations only (up to 100, the list's length,
 * which is also Realtime's limit for an `in` filter), so each new message is
 * checked against the people who have it in their list, not against everyone
 * on a messages page.
 */
export function ConversationListLive({ userId, conversationIds }: { userId: string; conversationIds: string[] }) {
  const router = useRouter();
  const key = conversationIds.slice(0, 100).join(",");

  useEffect(() => {
    if (!key) return;
    let channel: RealtimeChannel | null = null;
    let closed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    void getRealtimeClient(userId).then((supabase) => {
      if (closed) return;
      channel = supabase
        .channel(`conversation-list:${userId}`)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=in.(${key})` }, () => {
          // Messages close together make one refresh.
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => router.refresh(), 800);
        })
        .subscribe();
    });
    return () => {
      closed = true;
      if (timer) clearTimeout(timer);
      if (channel) void getBrowserClient().removeChannel(channel);
    };
  }, [router, userId, key]);

  return null;
}
