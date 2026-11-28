import { useCallback, useState } from "react";
import { Alert, ScrollView, View } from "react-native";
import { useFocusEffect, useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { useAuth } from "../../src/lib/auth";
import { dbCode, errorText } from "../../src/lib/errors";
import { formatDay } from "../../src/lib/format";
import { directConversation, friendAction, type Relation } from "../../src/lib/people";
import { publicUrl, supabase } from "../../src/lib/supabase";
import { st } from "../../src/lib/texts";
import { Avatar, Badge, Button, Card, Empty, Loading, Notice, T } from "../../src/ui/kit";
import { PitchArt } from "../../src/ui/pitch-art";
import { useColors } from "../../src/ui/theme";

interface Player {
  id: string;
  display_name: string;
  username: string | null;
  avatar_path: string | null;
  bio: string | null;
  positions: string[];
  skill_level: string | null;
  preferred_formats: string[];
  city: { name_ar: string } | null;
}

/**
 * A player's page (the site's /players/[id]): who they are and how they play,
 * when they were last active (for friends and people they talk with), and
 * adding them, messaging them or blocking them.
 */
export default function PlayerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const router = useRouter();
  const navigation = useNavigation();
  const colors = useColors();
  const [player, setPlayer] = useState<Player | null | undefined>(undefined);
  const [relation, setRelation] = useState<Relation>("none");
  const [seen, setSeen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "danger" | "success"; text: string } | null>(null);

  const load = useCallback(async () => {
    const db = supabase();
    const { data } = await db.from("profiles").select("id, display_name, username, avatar_path, bio, positions, skill_level, preferred_formats, city:cities(name_ar)").eq("id", id).maybeSingle();
    const p = (data as unknown as Player | null) ?? null;
    setPlayer(p);
    if (p) navigation.setOptions({ title: p.display_name });
    if (p?.username) {
      const { data: rel } = await db.rpc("find_member", { p_username: p.username });
      setRelation((((rel ?? []) as { relation: Relation }[])[0]?.relation ?? "none") as Relation);
    }
    const { data: last } = await db.rpc("last_seen", { p_user_ids: [id] });
    setSeen(((last ?? []) as { last_seen_at: string }[])[0]?.last_seen_at ?? null);
  }, [id, navigation]);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (player === undefined) return <Loading />;
  if (player === null) return <Empty title="لم نجد هذا اللاعب" />;
  const self = player.id === session?.user.id;
  const activeNow = seen ? Date.now() - Date.parse(seen) < 150_000 : false;

  const run = async (fn: () => Promise<string | null>, done: string) => {
    setBusy(true);
    setMessage(null);
    const error = await fn();
    setBusy(false);
    if (error) return setMessage({ tone: "danger", text: errorText(error) });
    setMessage({ tone: "success", text: done });
    await load();
  };
  const message_ = async () => {
    setBusy(true);
    const res = await directConversation(player.id);
    setBusy(false);
    if ("error" in res) return setMessage({ tone: "danger", text: errorText(res.error) });
    router.push({ pathname: "/chat/[id]", params: { id: res.id, title: player.display_name } });
  };

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
      <View style={{ height: 120, overflow: "hidden" }}>
        <PitchArt />
      </View>
      <View style={{ alignItems: "center", marginTop: -48, gap: 6, paddingHorizontal: 16 }}>
        <View style={{ borderRadius: 60, borderWidth: 4, borderColor: colors.bg }}>
          <Avatar uri={publicUrl("avatars", player.avatar_path)} name={player.display_name} size={96} />
        </View>
        <T weight="bold" style={{ fontSize: 24 }}>{player.display_name}</T>
        {player.username ? <T style={{ color: colors.accentText }}>@{player.username}</T> : null}
        {seen ? (
          <T muted style={{ fontSize: 13 }}>{activeNow ? "● نشط الآن" : `نشط ${formatDay(seen)}`}</T>
        ) : null}
        {player.city ? <T muted>{player.city.name_ar}</T> : null}
      </View>

      <View style={{ padding: 16, gap: 12 }}>
        {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
        {!self && relation !== "blocked" ? (
          <View style={{ flexDirection: "row", gap: 10 }}>
            {relation === "none" && player.username ? <Button label="إضافة صديق" style={{ flex: 1 }} busy={busy} onPress={() => void run(() => friendAction("add", { id: player.id, username: player.username }), "تم إرسال الطلب.")} /> : null}
            {relation === "incoming" ? <Button label="قبول الصداقة" style={{ flex: 1 }} busy={busy} onPress={() => void run(() => friendAction("accept", { id: player.id }), "أصبحتما صديقين.")} /> : null}
            {relation === "requested" ? <Button label="تم إرسال الطلب" variant="secondary" style={{ flex: 1 }} disabled onPress={() => undefined} /> : null}
            {relation === "friend" ? <Button label="صديقك ✓" variant="secondary" style={{ flex: 1 }} onPress={() => Alert.alert("إزالة الصديق؟", "", [{ text: "تراجع", style: "cancel" }, { text: "إزالة", style: "destructive", onPress: () => void run(() => friendAction("remove", { id: player.id }), "أُزيل من أصدقائك.") }])} /> : null}
            <Button label="مراسلة" variant="secondary" style={{ flex: 1 }} busy={busy} onPress={message_} />
          </View>
        ) : null}

        {player.positions.length || player.skill_level ? (
          <Card>
            <T weight="bold">كيف يلعب</T>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {player.positions.map((p) => <Badge key={p} label={st(`enums.position.${p}`)} tone="accent" />)}
              {player.skill_level ? <Badge label={st(`enums.skill.${player.skill_level}`)} /> : null}
              {player.preferred_formats.map((f) => <Badge key={f} label={f.replace("v", " × ")} />)}
            </View>
          </Card>
        ) : null}
        {player.bio ? (
          <Card>
            <T muted>{player.bio}</T>
          </Card>
        ) : null}

        {!self ? (
          <Button
            label={relation === "blocked" ? "إلغاء الحظر" : "حظر"}
            variant="ghost"
            onPress={() =>
              Alert.alert(relation === "blocked" ? "إلغاء حظر هذا اللاعب؟" : "حظر هذا اللاعب؟", relation === "blocked" ? "" : "لن يراسلك ولن يرى متى كنت نشطاً.", [
                { text: "تراجع", style: "cancel" },
                {
                  text: relation === "blocked" ? "إلغاء الحظر" : "حظر",
                  style: "destructive",
                  onPress: () =>
                    void run(async () => {
                      const { error } = await supabase().rpc(relation === "blocked" ? "unblock_user" : "block_user", { p_user_id: player.id });
                      return error ? dbCode(error) : null;
                    }, relation === "blocked" ? "أُلغي الحظر." : "تم الحظر."),
                },
              ])
            }
          />
        ) : null}
      </View>
    </ScrollView>
  );
}
