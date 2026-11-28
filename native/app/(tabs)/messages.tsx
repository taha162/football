import { useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, RefreshControl, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../../src/lib/auth";
import { formatListTime } from "../../src/lib/format";
import { publicUrl, supabase } from "../../src/lib/supabase";
import { Avatar, Empty, Loading, T } from "../../src/ui/kit";
import { useColors } from "../../src/ui/theme";

interface Row {
  conversation_id: string;
  kind: string;
  title: string | null;
  last_message_at: string | null;
  last_message: string | null;
  last_kind: string | null;
  unread_count: number;
  pinned?: boolean;
  muted?: boolean;
  nickname?: string | null;
}

const KIND: Record<string, string> = { match: "محادثة المباراة", team: "محادثة الفريق", booking: "محادثة الحجز", tournament: "محادثة البطولة", challenge: "تحدٍّ", group: "مجموعة", direct: "محادثة" };

/** What the last message carried, as in the site's list. */
function preview(r: Row): string {
  if (r.last_kind === "location") return "📍 الموقع";
  if (r.last_kind === "voice") return "🎤 رسالة صوتية";
  if (r.last_kind === "video") return `🎥 ${r.last_message || "فيديو"}`;
  if (r.last_kind === "call") return "📞 مكالمة";
  if (r.last_message === "[deleted]" || r.last_message === "[removed]") return "رسالة محذوفة";
  if (r.last_message === "") return "📷 صورة";
  return r.last_message ?? "لا رسائل بعد.";
}

/** The member's conversations, newest first; live: a new message moves its conversation up. */
export default function Messages() {
  const colors = useColors();
  const { session } = useAuth();
  const router = useRouter();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [faces, setFaces] = useState<Map<string, { name: string; avatar: string | null }>>(new Map());
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!session) return;
    const db = supabase();
    const { data } = await db.rpc("my_conversations", { p_limit: 100 });
    const list = ((data ?? []) as Row[]).sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)));
    // One-to-one conversations show the other person: one request for the whole list.
    const direct = list.filter((r) => r.kind === "direct").map((r) => r.conversation_id);
    const { data: others } = direct.length
      ? await db.from("conversation_members").select("conversation_id, profile:profiles(display_name, avatar_path)").in("conversation_id", direct).neq("user_id", session.user.id)
      : { data: [] };
    setFaces(new Map(((others ?? []) as unknown as { conversation_id: string; profile: { display_name: string; avatar_path: string | null } | null }[]).map((o) => [o.conversation_id, { name: o.profile?.display_name ?? "", avatar: o.profile?.avatar_path ?? null }])));
    setRows(list);
  }, [session]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  // New messages in any of the member's conversations (RLS lets only theirs through).
  useEffect(() => {
    const db = supabase();
    const channel = db
      .channel("my-messages")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, () => void load())
      .subscribe();
    return () => {
      void db.removeChannel(channel);
    };
  }, [load]);

  if (!rows) return <Loading />;
  return (
    <FlatList
      data={rows}
      keyExtractor={(r) => r.conversation_id}
      contentContainerStyle={{ flexGrow: 1 }}
      ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: colors.line, marginStart: 76 }} />}
      refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.accentText} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
      ListEmptyComponent={<Empty title="لا محادثات بعد"><T muted style={{ textAlign: "center" }}>راسل لاعباً من صفحة مباراة أو من صفحته.</T></Empty>}
      renderItem={({ item }) => {
        const face = faces.get(item.conversation_id);
        const title = item.nickname || item.title || face?.name || KIND[item.kind] || "محادثة";
        const unread = Number(item.unread_count) > 0;
        return (
          <Pressable
            onPress={() => router.push({ pathname: "/chat/[id]", params: { id: item.conversation_id, title } })}
            style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 12 }, pressed && { backgroundColor: colors.surface2 }]}
            accessibilityRole="button"
            accessibilityLabel={`${title}${unread ? `، ${item.unread_count} غير مقروءة` : ""}`}
          >
            {item.kind === "direct" ? (
              <Avatar uri={publicUrl("avatars", face?.avatar)} name={title} size={50} />
            ) : (
              <View style={{ width: 50, height: 50, borderRadius: 25, backgroundColor: colors.surface3, alignItems: "center", justifyContent: "center" }}>
                <Ionicons name={item.kind === "group" ? "people" : item.kind === "match" ? "football" : "chatbubbles"} size={22} color={colors.muted} />
              </View>
            )}
            <View style={{ flex: 1, gap: 2 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
                <T weight={unread ? "bold" : "semibold"} numberOfLines={1} style={{ flex: 1 }}>{title}</T>
                {item.last_message_at ? <T style={{ fontSize: 12, color: unread ? colors.accentText : colors.faint }}>{formatListTime(item.last_message_at)}</T> : null}
              </View>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <T muted numberOfLines={1} style={{ flex: 1, fontSize: 14 }}>{preview(item)}</T>
                {item.muted ? <Ionicons name="volume-mute" size={14} color={colors.faint} /> : null}
                {unread ? (
                  <View style={{ minWidth: 22, height: 22, borderRadius: 11, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 }}>
                    <T weight="bold" style={{ color: colors.accentInk, fontSize: 12 }}>{Number(item.unread_count) > 99 ? "99+" : item.unread_count}</T>
                  </View>
                ) : null}
              </View>
            </View>
          </Pressable>
        );
      }}
    />
  );
}
