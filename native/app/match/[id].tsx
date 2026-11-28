import { useCallback, useState } from "react";
import { Alert, Linking, ScrollView, View } from "react-native";
import { useFocusEffect, useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../../src/lib/auth";
import { dbCode, errorText } from "../../src/lib/errors";
import { formatDateTime, formatPrice, formatTime } from "../../src/lib/format";
import { formatLabel, openSpots, STATUS } from "../../src/lib/matches";
import { publicUrl, supabase } from "../../src/lib/supabase";
import { Avatar, Badge, Button, Card, Empty, Loading, Notice, T } from "../../src/ui/kit";
import { colors } from "../../src/ui/theme";

interface Match {
  id: string;
  title: string;
  description: string | null;
  status: string;
  starts_at: string;
  ends_at: string;
  format: string;
  total_players: number;
  reserved_spots: number;
  confirmed_count: number;
  waitlist_count: number;
  price_per_player: number;
  currency: string;
  join_policy: string;
  organizer_id: string;
  venue: { id: string; name: string; address: string | null; latitude: number | null; longitude: number | null } | null;
  area: { name_ar: string } | null;
  city: { name_ar: string } | null;
  organizer: { id: string; display_name: string; avatar_path: string | null } | null;
}
interface Player {
  user_id: string;
  status: string;
  position: string | null;
  profile: { id: string; display_name: string; avatar_path: string | null } | null;
}

const POSITION: Record<string, string> = { goalkeeper: "حارس مرمى", defender: "مدافع", midfielder: "لاعب وسط", forward: "مهاجم" };

/** A match: when, where, who plays, and joining or leaving it (the database decides: join_match / leave_match). */
export default function MatchScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const router = useRouter();
  const navigation = useNavigation();
  const [match, setMatch] = useState<Match | null | undefined>(undefined);
  const [players, setPlayers] = useState<Player[]>([]);
  const [waiting, setWaiting] = useState(false);
  const [chat, setChat] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "danger" | "success"; text: string } | null>(null);
  const me = session?.user.id;

  const load = useCallback(async () => {
    const db = supabase();
    const [{ data: m }, { data: roster }, { data: queue }, { data: conv }] = await Promise.all([
      db.from("matches")
        .select("id, title, description, status, starts_at, ends_at, format, total_players, reserved_spots, confirmed_count, waitlist_count, price_per_player, currency, join_policy, organizer_id, venue:venues(id, name, address, latitude, longitude), area:areas(name_ar), city:cities(name_ar), organizer:profiles!matches_organizer_id_fkey(id, display_name, avatar_path)")
        .eq("id", id)
        .maybeSingle(),
      db.from("match_participants").select("user_id, status, position, profile:profiles!match_participants_user_id_fkey(id, display_name, avatar_path)").eq("match_id", id).in("status", ["confirmed", "pending"]).order("joined_at"),
      me ? db.from("match_waitlist").select("id").eq("match_id", id).eq("user_id", me).eq("status", "waiting").maybeSingle() : Promise.resolve({ data: null }),
      db.rpc("entity_conversation_id", { p_kind: "match", p_entity_id: id }),
    ]);
    setMatch((m as unknown as Match | null) ?? null);
    setPlayers((roster ?? []) as unknown as Player[]);
    setWaiting(Boolean(queue));
    setChat((conv as string | null) ?? null);
    if (m) navigation.setOptions({ title: (m as { title: string }).title });
  }, [id, me, navigation]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (match === undefined) return <Loading />;
  if (match === null) return <Empty title="لم نجد هذه المباراة" />;

  const mine = players.find((p) => p.user_id === me);
  const left = openSpots(match);
  const isOrganizer = match.organizer_id === me;
  const open = ["open", "full", "confirmed"].includes(match.status) && Date.parse(match.starts_at) > Date.now();
  const place = [match.venue?.name, match.area?.name_ar ?? match.city?.name_ar].filter(Boolean).join("، ");

  const act = async (fn: "join_match" | "leave_match", args: Record<string, unknown>, done: string) => {
    setBusy(true);
    setMessage(null);
    const { error } = await supabase().rpc(fn, args);
    setBusy(false);
    if (error) return setMessage({ tone: "danger", text: errorText(dbCode(error)) });
    setMessage({ tone: "success", text: done });
    await load();
  };
  const join = (waitlist = false) =>
    act("join_match", { p_match_id: match.id, p_waitlist_if_full: waitlist }, waitlist ? "أنت في قائمة الانتظار." : match.join_policy === "approval" ? "أُرسل طلبك إلى المنظّم." : "انضممت إلى المباراة.");
  const leave = () =>
    Alert.alert("مغادرة المباراة؟", "يُفتح مكانك لغيرك.", [
      { text: "إلغاء", style: "cancel" },
      { text: "مغادرة", style: "destructive", onPress: () => void act("leave_match", { p_match_id: match.id }, "غادرت المباراة.") },
    ]);

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
      <Card>
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
          <Badge label={formatLabel(match.format)} tone="accent" />
          <Badge label={STATUS[match.status] ?? match.status} tone={match.status === "cancelled" ? "warning" : "neutral"} />
          {match.join_policy === "approval" ? <Badge label="بموافقة المنظّم" /> : null}
        </View>
        <T weight="bold" style={{ fontSize: 22 }}>{match.title}</T>
        <Row icon="time-outline" text={`${formatDateTime(match.starts_at)} – ${formatTime(match.ends_at)}`} />
        {place ? <Row icon="location-outline" text={place} /> : null}
        <Row icon="cash-outline" text={`${formatPrice(match.price_per_player, match.currency)} للاعب`} />
        <Row icon="people-outline" text={`${match.confirmed_count} من ${match.total_players - match.reserved_spots} لاعباً${match.waitlist_count ? ` · ${match.waitlist_count} في الانتظار` : ""}`} />
        {match.description ? <T muted style={{ marginTop: 4 }}>{match.description}</T> : null}
      </Card>

      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}

      {open && !isOrganizer ? (
        mine ? (
          <View style={{ gap: 8 }}>
            <Notice tone="success">{mine.status === "pending" ? "طلبك ينتظر موافقة المنظّم." : "أنت مسجّل في هذه المباراة."}</Notice>
            <Button label="مغادرة المباراة" variant="danger" onPress={leave} busy={busy} />
          </View>
        ) : waiting ? (
          <Notice tone="info">أنت في قائمة الانتظار. ننبّهك حين يُفتح مكان.</Notice>
        ) : match.join_policy === "invite_only" ? (
          <Notice tone="info">هذه المباراة بالدعوة فقط.</Notice>
        ) : left > 0 ? (
          <Button label={match.join_policy === "approval" ? "اطلب الانضمام" : "انضم إلى المباراة"} onPress={() => void join()} busy={busy} />
        ) : (
          <Button label="انضم إلى قائمة الانتظار" variant="secondary" onPress={() => void join(true)} busy={busy} />
        )
      ) : null}

      {chat && (mine || isOrganizer) ? <Button label="محادثة المباراة" variant="secondary" onPress={() => router.push(`/chat/${chat}`)} /> : null}
      {match.venue?.latitude != null && match.venue.longitude != null ? (
        <Button
          label="الاتجاهات إلى الملعب"
          variant="ghost"
          onPress={() => void Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${match.venue!.latitude},${match.venue!.longitude}`)}
        />
      ) : null}

      <T weight="bold" style={{ fontSize: 18 }}>اللاعبون ({players.filter((p) => p.status === "confirmed").length})</T>
      <Card>
        {match.organizer ? <Person name={match.organizer.display_name} avatar={match.organizer.avatar_path} note="المنظّم" /> : null}
        {players.map((p) =>
          p.profile ? (
            <Person key={p.user_id} name={p.profile.display_name} avatar={p.profile.avatar_path} note={[p.position ? POSITION[p.position] : null, p.status === "pending" ? "ينتظر الموافقة" : null].filter(Boolean).join(" · ")} />
          ) : null,
        )}
        {players.length === 0 ? <T muted>لم ينضم أحد بعد.</T> : null}
      </Card>
    </ScrollView>
  );
}

function Row({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <Ionicons name={icon} size={18} color={colors.muted} />
      <T muted style={{ flex: 1 }}>{text}</T>
    </View>
  );
}

function Person({ name, avatar, note }: { name: string; avatar: string | null; note?: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 6 }}>
      <Avatar uri={publicUrl("avatars", avatar)} name={name} size={40} />
      <View style={{ flex: 1 }}>
        <T weight="semibold">{name}</T>
        {note ? <T muted style={{ fontSize: 13 }}>{note}</T> : null}
      </View>
    </View>
  );
}
