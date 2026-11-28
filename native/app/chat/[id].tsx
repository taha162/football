import { useCallback, useEffect, useRef, useState } from "react";
import { FlatList, KeyboardAvoidingView, Platform, Pressable, TextInput, View } from "react-native";
import { useLocalSearchParams, useNavigation } from "expo-router";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "../../src/lib/auth";
import { dbCode, errorText } from "../../src/lib/errors";
import { formatDay, formatTime } from "../../src/lib/format";
import { supabase } from "../../src/lib/supabase";
import { Loading, Notice, T } from "../../src/ui/kit";
import { colors, fonts } from "../../src/ui/theme";

interface Message {
  id: number;
  sender_id: string | null;
  body: string;
  image_path: string | null;
  voice_path: string | null;
  video_path: string | null;
  location_lat: number | null;
  location_lng: number | null;
  call_outcome: string | null;
  deleted_at: string | null;
  created_at: string;
  image_url?: string | null;
}

const COLUMNS = "id, sender_id, body, image_path, voice_path, video_path, location_lat, location_lng, call_outcome, deleted_at, created_at";
const PAGE = 50;
const thumbOf = (path: string) => `${path.replace(/\.[a-z0-9]+$/i, "")}.thumb.jpg`;

/** Pictures are private: signed links for an hour, made with the member's own session (small copies when there are). */
async function signPictures(list: Message[]): Promise<Message[]> {
  const paths = list.flatMap((m) => (m.image_path && !m.deleted_at ? [thumbOf(m.image_path), m.image_path] : []));
  if (!paths.length) return list;
  const { data } = await supabase().storage.from("message-images").createSignedUrls(paths, 3600);
  const urls = new Map((data ?? []).flatMap((s) => (s.path && s.signedUrl && !s.error ? [[s.path, s.signedUrl] as const] : [])));
  return list.map((m) => (m.image_path ? { ...m, image_url: urls.get(thumbOf(m.image_path)) ?? urls.get(m.image_path) ?? null } : m));
}

/**
 * A conversation: its messages, live (Supabase Realtime: the database lets
 * only its members' rows through), and the box to write. Pictures show; voice
 * notes, videos and calls are named, and play on the site for now.
 */
export default function Chat() {
  const { id, title } = useLocalSearchParams<{ id: string; title?: string }>();
  const { session } = useAuth();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const me = session?.user.id;
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [group, setGroup] = useState(false);
  const [locked, setLocked] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const known = useRef(new Set<string>());

  const learnNames = useCallback(async (list: Message[]) => {
    const ids = [...new Set(list.map((m) => m.sender_id).filter((s): s is string => Boolean(s) && !known.current.has(s!)))];
    if (!ids.length) return;
    ids.forEach((s) => known.current.add(s));
    const { data } = await supabase().from("profiles").select("id, display_name").in("id", ids);
    setNames((prev) => ({ ...prev, ...Object.fromEntries((data ?? []).map((p: { id: string; display_name: string }) => [p.id, p.display_name])) }));
  }, []);

  useEffect(() => {
    if (title) navigation.setOptions({ title });
  }, [navigation, title]);

  // The latest page, without what the member deleted for themselves; then read.
  useEffect(() => {
    let alive = true;
    void (async () => {
      const db = supabase();
      const [{ data: conv }, { data: pref }] = await Promise.all([
        db.from("conversations").select("kind, is_locked").eq("id", id).maybeSingle(),
        me ? db.from("conversation_prefs").select("cleared_at").eq("conversation_id", id).eq("user_id", me).maybeSingle() : Promise.resolve({ data: null }),
      ]);
      let q = db.from("messages").select(COLUMNS).eq("conversation_id", id).order("id", { ascending: false }).limit(PAGE);
      const cleared = (pref as { cleared_at?: string | null } | null)?.cleared_at;
      if (cleared) q = q.gt("created_at", cleared);
      const { data } = await q;
      if (!alive) return;
      const list = await signPictures((data ?? []) as Message[]);
      setGroup((conv as { kind?: string } | null)?.kind !== "direct");
      setLocked(Boolean((conv as { is_locked?: boolean } | null)?.is_locked));
      setMessages(list);
      void learnNames(list);
      void db.rpc("mark_conversation_read", { p_conversation_id: id });
    })();
    return () => {
      alive = false;
    };
  }, [id, me, learnNames]);

  // Live: new messages, and deletions or edits of those shown.
  useEffect(() => {
    const db = supabase();
    const channel = db
      .channel(`conversation:${id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${id}` }, async (payload) => {
        const [msg] = await signPictures([payload.new as Message]);
        setMessages((prev) => (prev && !prev.some((m) => m.id === msg.id) ? [msg, ...prev] : prev));
        void learnNames([msg]);
        if (msg.sender_id !== me) void db.rpc("mark_conversation_read", { p_conversation_id: id });
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages", filter: `conversation_id=eq.${id}` }, (payload) => {
        const next = payload.new as Message;
        setMessages((prev) => prev?.map((m) => (m.id === next.id ? { ...m, body: next.body, deleted_at: next.deleted_at } : m)) ?? prev);
      })
      .subscribe();
    return () => {
      void db.removeChannel(channel);
    };
  }, [id, me, learnNames]);

  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setError(null);
    const { data, error: sendError } = await supabase().rpc("send_message", { p_conversation_id: id, p_body: body });
    setSending(false);
    if (sendError) return setError(errorText(dbCode(sendError)));
    setText("");
    // Shown at once; the live copy is the same message, so it doesn't appear twice.
    if (typeof data === "number" && me) {
      setMessages((prev) => (prev && !prev.some((m) => m.id === data) ? [{ id: data, sender_id: me, body, image_path: null, voice_path: null, video_path: null, location_lat: null, location_lng: null, call_outcome: null, deleted_at: null, created_at: new Date().toISOString() }, ...prev] : prev));
    }
  };

  if (!messages) return <Loading />;
  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}>
      <FlatList
        data={messages}
        inverted
        keyExtractor={(m) => String(m.id)}
        contentContainerStyle={{ padding: 12, gap: 6 }}
        renderItem={({ item, index }) => {
          const older = messages[index + 1];
          const newDay = !older || formatDay(older.created_at) !== formatDay(item.created_at);
          return (
            <View>
              {newDay ? (
                <View style={{ alignSelf: "center", backgroundColor: colors.surface2, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 3, marginVertical: 8 }}>
                  <T muted style={{ fontSize: 12 }}>{formatDay(item.created_at)}</T>
                </View>
              ) : null}
              <Bubble message={item} mine={item.sender_id === me} name={group && item.sender_id !== me ? names[item.sender_id ?? ""] : undefined} />
            </View>
          );
        }}
        ListEmptyComponent={<T muted style={{ textAlign: "center", padding: 24, transform: [{ scaleY: -1 }] }}>لا رسائل بعد. ابدأ المحادثة.</T>}
      />
      {error ? (
        <View style={{ paddingHorizontal: 12 }}>
          <Notice tone="danger">{error}</Notice>
        </View>
      ) : null}
      {locked ? (
        <View style={{ padding: 14, paddingBottom: 14 + insets.bottom, backgroundColor: colors.surface }}>
          <T muted style={{ textAlign: "center" }}>هذه المحادثة للقراءة فقط.</T>
        </View>
      ) : (
        <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 8, padding: 8, paddingBottom: 8 + insets.bottom, backgroundColor: colors.surface, borderTopColor: colors.line, borderTopWidth: 1 }}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="اكتب رسالة…"
            placeholderTextColor={colors.faint}
            accessibilityLabel="اكتب رسالة"
            multiline
            maxLength={2000}
            style={{ flex: 1, maxHeight: 140, minHeight: 44, borderRadius: 22, backgroundColor: colors.surface2, color: colors.ink, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 10, fontFamily: fonts.regular, fontSize: 16, textAlign: "left" }}
          />
          <Pressable
            onPress={send}
            disabled={!text.trim() || sending}
            accessibilityRole="button"
            accessibilityLabel="إرسال"
            style={({ pressed }) => [{ width: 44, height: 44, borderRadius: 22, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center", opacity: !text.trim() || sending ? 0.5 : pressed ? 0.8 : 1 }]}
          >
            {/* The arrow points the way the text runs. */}
            <Ionicons name="send" size={20} color={colors.accentInk} style={{ transform: [{ scaleX: -1 }] }} />
          </Pressable>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

function Bubble({ message: m, mine, name }: { message: Message; mine: boolean; name?: string }) {
  const content = m.deleted_at ? (
    <T muted style={{ fontStyle: "italic" }}>حُذفت هذه الرسالة</T>
  ) : m.call_outcome ? (
    <T>📞 مكالمة صوتية</T>
  ) : m.location_lat != null ? (
    <T>📍 موقع</T>
  ) : m.voice_path ? (
    <T>🎤 رسالة صوتية (استمع إليها في الموقع)</T>
  ) : m.video_path ? (
    <T>🎥 {m.body || "فيديو"}</T>
  ) : (
    <>
      {m.image_url ? <Image source={m.image_url} style={{ width: 220, height: 220, borderRadius: 12 }} contentFit="cover" accessibilityLabel="صورة" /> : m.image_path ? <T>📷 صورة</T> : null}
      {m.body ? <T selectable>{m.body}</T> : null}
    </>
  );
  return (
    <View style={{ alignSelf: mine ? "flex-start" : "flex-end", maxWidth: "82%" }}>
      <View style={{ backgroundColor: mine ? "#1f4d2b" : colors.surface2, borderRadius: 18, paddingHorizontal: 12, paddingVertical: 8, gap: 4 }}>
        {name ? <T weight="semibold" style={{ color: colors.accent, fontSize: 13 }}>{name}</T> : null}
        {content}
        <T style={{ fontSize: 11, color: colors.faint, alignSelf: "flex-end" }}>{formatTime(m.created_at)}</T>
      </View>
    </View>
  );
}
