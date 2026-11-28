import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Linking, Platform, Pressable, TextInput, View } from "react-native";
import { useLocalSearchParams, useNavigation } from "expo-router";
import { Image } from "expo-image";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { useVideoPlayer, VideoView } from "expo-video";
import * as Location from "expo-location";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "../../src/lib/auth";
import { dbCode, errorText } from "../../src/lib/errors";
import { formatDay, formatTime } from "../../src/lib/format";
import { pickPicture, siteUpload } from "../../src/lib/media";
import { supabase } from "../../src/lib/supabase";
import { Loading, Notice, T } from "../../src/ui/kit";
import { fonts, useColors } from "../../src/ui/theme";

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
  voice_url?: string | null;
  video_url?: string | null;
  poster_url?: string | null;
}

const COLUMNS = "id, sender_id, body, image_path, voice_path, video_path, location_lat, location_lng, call_outcome, deleted_at, created_at";
const PAGE = 50;
const thumbOf = (path: string) => `${path.replace(/\.[a-z0-9]+$/i, "")}.thumb.jpg`;
const posterOf = (path: string) => `${path.replace(/\.[a-z0-9]+$/i, "")}.poster.jpg`;

async function sign(bucket: string, paths: string[]): Promise<Map<string, string>> {
  if (!paths.length) return new Map();
  const { data } = await supabase().storage.from(bucket).createSignedUrls(paths, 3600);
  return new Map((data ?? []).flatMap((s) => (s.path && s.signedUrl && !s.error ? [[s.path, s.signedUrl] as const] : [])));
}

/**
 * The files are private: signed links for an hour, made with the member's own
 * session (the storage rules let only the conversation's members sign them).
 * Pictures show their small copy when there is one; videos their still.
 */
async function signFiles(list: Message[]): Promise<Message[]> {
  const live = list.filter((m) => !m.deleted_at);
  const [pictures, voices, videos] = await Promise.all([
    sign("message-images", live.flatMap((m) => (m.image_path ? [thumbOf(m.image_path), m.image_path] : []))),
    sign("message-voice", live.flatMap((m) => (m.voice_path ? [m.voice_path] : []))),
    sign("message-videos", live.flatMap((m) => (m.video_path ? [m.video_path, posterOf(m.video_path)] : []))),
  ]);
  return list.map((m) =>
    m.deleted_at
      ? m
      : {
          ...m,
          image_url: m.image_path ? pictures.get(thumbOf(m.image_path)) ?? pictures.get(m.image_path) ?? null : null,
          voice_url: m.voice_path ? voices.get(m.voice_path) ?? null : null,
          video_url: m.video_path ? videos.get(m.video_path) ?? null : null,
          poster_url: m.video_path ? videos.get(posterOf(m.video_path)) ?? null : null,
        },
  );
}

/**
 * A conversation: its messages, live (Supabase Realtime: the database lets
 * only its members' rows through), and the box to write: text, a picture
 * (gallery or camera) or the member's location. Pictures, voice notes and
 * videos play here; a location opens in the phone's maps.
 */
export default function Chat() {
  const colors = useColors();
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
      const list = await signFiles((data ?? []) as Message[]);
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
        const [msg] = await signFiles([payload.new as Message]);
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

  // A picture or a location goes through the site (/api/app/message), which checks and stores the file as it does for the site.
  const sendAttachment = async (fields: Record<string, string>, files: Record<string, string | undefined> = {}) => {
    setSending(true);
    setError(null);
    const res = await siteUpload<{ id?: number }>("/api/app/message", { conversation_id: id, ...fields }, files);
    setSending(false);
    if (res.error) setError(errorText(res.error));
  };
  const sendPicture = async (source: "library" | "camera") => {
    const picked = await pickPicture(source, { max: 1600, thumb: 480 });
    if (picked) await sendAttachment({}, { image: picked.uri, image_thumb: picked.thumb });
  };
  const sendLocation = async () => {
    const { granted } = await Location.requestForegroundPermissionsAsync();
    if (!granted) return setError("اسمح للتطبيق بمعرفة موقعك من إعدادات الهاتف لإرساله.");
    setSending(true);
    try {
      const here = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      await sendAttachment({ location_lat: String(here.coords.latitude), location_lng: String(here.coords.longitude), location_accuracy: String(Math.round(here.coords.accuracy ?? 0)) });
    } catch {
      setSending(false);
      setError("تعذّر تحديد موقعك الآن. حاول مرة أخرى.");
    }
  };
  const attach = () =>
    Alert.alert("إرسال", undefined, [
      { text: "صورة من المعرض", onPress: () => void sendPicture("library") },
      { text: "التقاط صورة", onPress: () => void sendPicture("camera") },
      { text: "موقعي الحالي", onPress: () => void sendLocation() },
      { text: "إلغاء", style: "cancel" },
    ]);

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
          <Pressable
            onPress={attach}
            disabled={sending}
            accessibilityRole="button"
            accessibilityLabel="إرفاق صورة أو موقع"
            style={({ pressed }) => [{ width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surface2, alignItems: "center", justifyContent: "center", opacity: sending ? 0.5 : pressed ? 0.7 : 1 }]}
          >
            {sending ? <ActivityIndicator color={colors.muted} /> : <Ionicons name="add" size={24} color={colors.ink} />}
          </Pressable>
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
  const colors = useColors();
  const content = m.deleted_at ? (
    <T muted style={{ fontStyle: "italic" }}>حُذفت هذه الرسالة</T>
  ) : m.call_outcome ? (
    <T>📞 مكالمة صوتية</T>
  ) : m.location_lat != null && m.location_lng != null ? (
    <Place lat={m.location_lat} lng={m.location_lng} />
  ) : m.voice_path ? (
    m.voice_url ? <Voice uri={m.voice_url} /> : <T>🎤 رسالة صوتية</T>
  ) : m.video_path ? (
    <>
      {m.video_url ? <Video uri={m.video_url} poster={m.poster_url} /> : <T>🎥 فيديو</T>}
      {m.body ? <T selectable>{m.body}</T> : null}
    </>
  ) : (
    <>
      {m.image_url ? <Image source={m.image_url} style={{ width: 220, height: 220, borderRadius: 12 }} contentFit="cover" accessibilityLabel="صورة" /> : m.image_path ? <T>📷 صورة</T> : null}
      {m.body ? <T selectable>{m.body}</T> : null}
    </>
  );
  return (
    <View style={{ alignSelf: mine ? "flex-start" : "flex-end", maxWidth: "82%" }}>
      <View style={{ backgroundColor: mine ? "#1f4d2b" : colors.surface2, borderRadius: 18, paddingHorizontal: 12, paddingVertical: 8, gap: 4 }}>
        {name ? <T weight="semibold" style={{ color: colors.accentText, fontSize: 13 }}>{name}</T> : null}
        {content}
        <T style={{ fontSize: 11, color: colors.faint, alignSelf: "flex-end" }}>{formatTime(m.created_at)}</T>
      </View>
    </View>
  );
}

/** A shared location: opens in the phone's maps app. */
function Place({ lat, lng }: { lat: number; lng: number }) {
  const colors = useColors();
  const open = () => {
    const url = Platform.select({ ios: `maps:0,0?q=${lat},${lng}`, android: `geo:${lat},${lng}?q=${lat},${lng}`, default: `https://www.google.com/maps/search/?api=1&query=${lat},${lng}` });
    void Linking.openURL(url).catch(() => Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`));
  };
  return (
    <Pressable onPress={open} accessibilityRole="link" accessibilityLabel="فتح الموقع في الخرائط" style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4 }}>
      <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center" }}>
        <Ionicons name="location" size={20} color={colors.accentInk} />
      </View>
      <View>
        <T weight="semibold">موقع</T>
        <T muted style={{ fontSize: 12 }}>افتحه في الخرائط</T>
      </View>
    </Pressable>
  );
}

const clockOf = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

/** A voice note: play or pause, and how far along. */
function Voice({ uri }: { uri: string }) {
  const colors = useColors();
  const player = useAudioPlayer(uri);
  const status = useAudioPlayerStatus(player);
  const playing = status.playing;
  const toggle = () => {
    if (playing) return player.pause();
    if (status.duration > 0 && status.currentTime >= status.duration - 0.2) void player.seekTo(0);
    player.play();
  };
  const progress = status.duration > 0 ? Math.min(1, status.currentTime / status.duration) : 0;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, minWidth: 190 }}>
      <Pressable onPress={toggle} accessibilityRole="button" accessibilityLabel={playing ? "إيقاف مؤقت" : "تشغيل الرسالة الصوتية"} style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center" }}>
        <Ionicons name={playing ? "pause" : "play"} size={18} color={colors.accentInk} />
      </Pressable>
      <View style={{ flex: 1, gap: 4 }}>
        <View style={{ height: 4, borderRadius: 2, backgroundColor: colors.line, overflow: "hidden" }}>
          <View style={{ width: `${progress * 100}%`, height: 4, backgroundColor: colors.accentText }} />
        </View>
        <T muted style={{ fontSize: 11 }}>{clockOf(playing || status.currentTime > 0 ? status.currentTime : status.duration)}</T>
      </View>
    </View>
  );
}

/** A video: its still until played, then the phone's own player (full screen available). */
function Video({ uri, poster }: { uri: string; poster?: string | null }) {
  const [started, setStarted] = useState(false);
  const player = useVideoPlayer(started ? uri : null, (p) => {
    if (started) p.play();
  });
  if (!started) {
    return (
      <Pressable onPress={() => setStarted(true)} accessibilityRole="button" accessibilityLabel="تشغيل الفيديو" style={{ width: 220, height: 220, borderRadius: 12, overflow: "hidden", backgroundColor: "#000", alignItems: "center", justifyContent: "center" }}>
        {poster ? <Image source={poster} style={{ position: "absolute", width: 220, height: 220 }} contentFit="cover" /> : null}
        <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center" }}>
          <Ionicons name="play" size={26} color="#fff" />
        </View>
      </Pressable>
    );
  }
  return <VideoView player={player} style={{ width: 220, height: 220, borderRadius: 12 }} contentFit="cover" nativeControls fullscreenOptions={{ enable: true }} />;
}
