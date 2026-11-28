import { useCallback, useState } from "react";
import { ScrollView, Switch, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { useAuth } from "../src/lib/auth";
import { dbCode, errorText, fieldText } from "../src/lib/errors";
import { publicUrl, supabase } from "../src/lib/supabase";
import { st } from "../src/lib/texts";
import { Avatar, Button, Card, Field, Loading, Notice, T } from "../src/ui/kit";
import { useColors } from "../src/ui/theme";

/** The notifications a member may switch off (the site's OPTIONAL_NOTIFICATION_TYPES). */
const OPTIONAL = [
  "friend_request",
  "friend_accepted",
  "group_added",
  "match_participant_joined",
  "match_participant_left",
  "match_reminder",
  "match_invitation",
  "match_confirmed",
  "match_result_reported",
  "team_invitation",
  "team_join_request",
  "recruitment_response",
  "challenge_received",
  "team_match_scheduled",
  "tournament_update",
  "review_received",
];

/**
 * Settings, as the site's: the username, which notifications to get, whether
 * friends see when you were active, and the people you blocked. Each saves
 * through the same database functions as the site.
 */
export default function Settings() {
  const { profile, refreshProfile } = useAuth();
  const colors = useColors();
  const [muted, setMuted] = useState<Set<string> | null>(null);
  const [hidden, setHidden] = useState(false);
  const [blocked, setBlocked] = useState<{ blocked_id: string; profile: { display_name: string; avatar_path: string | null } | null }[]>([]);
  const [username, setUsername] = useState(profile?.username ?? "");
  const [message, setMessage] = useState<{ tone: "danger" | "success"; text: string } | null>(null);
  const [usernameError, setUsernameError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!profile) return;
    const db = supabase();
    const [{ data: prefs }, presence, { data: blocks }] = await Promise.all([
      db.from("user_preferences").select("notification_prefs").eq("user_id", profile.id).maybeSingle(),
      db.rpc("my_presence_hidden"),
      db.from("user_blocks").select("blocked_id, profile:profiles!user_blocks_blocked_id_fkey(display_name, avatar_path)").eq("blocker_id", profile.id),
    ]);
    const p = ((prefs as { notification_prefs?: Record<string, boolean> } | null)?.notification_prefs ?? {}) as Record<string, boolean>;
    setMuted(new Set(Object.entries(p).filter(([, v]) => v === false).map(([k]) => k)));
    setHidden(Boolean(presence.data));
    setBlocked((blocks ?? []) as unknown as typeof blocked);
  }, [profile]);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const saveNotifications = async (next: Set<string>) => {
    setMuted(next);
    const { error } = await supabase().rpc("update_my_preferences", { p_notification_prefs: Object.fromEntries([...next].map((k) => [k, false])) });
    if (error) setMessage({ tone: "danger", text: errorText(dbCode(error)) });
  };
  const saveUsername = async () => {
    setUsernameError(null);
    setMessage(null);
    const { error } = await supabase().rpc("set_username", { p_username: username.trim().replace(/^@+/, "") });
    if (error) {
      const code = dbCode(error);
      return code === "generic" || code === "forbidden" ? setMessage({ tone: "danger", text: errorText(code) }) : setUsernameError(fieldText(code));
    }
    await refreshProfile();
    setMessage({ tone: "success", text: "تم حفظ اسم المستخدم." });
  };

  if (!muted) return <Loading />;
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }} keyboardShouldPersistTaps="handled">
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}

      <T weight="bold" style={{ fontSize: 17 }}>اسم المستخدم</T>
      <Card>
        <Field label="اسم المستخدم" value={username} onChangeText={(v) => setUsername(v.replace(/^@/, "").toLowerCase())} autoCapitalize="none" autoCorrect={false} maxLength={20} hint="يبحث به أصدقاؤك عنك. يمكن تغييره بضع مرات في اليوم." error={usernameError} />
        <Button label="حفظ اسم المستخدم" variant="secondary" onPress={saveUsername} disabled={!username.trim() || username === profile?.username} />
      </Card>

      <T weight="bold" style={{ fontSize: 17 }}>الخصوصية</T>
      <Card>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <View style={{ flex: 1 }}>
            <T weight="semibold">إظهار متى كنت نشطاً</T>
            <T muted style={{ fontSize: 13 }}>يراه أصدقاؤك ومن تراسلهم فقط.</T>
          </View>
          <Switch
            value={!hidden}
            accessibilityLabel="إظهار متى كنت نشطاً"
            trackColor={{ true: colors.accentText, false: colors.lineStrong }}
            onValueChange={async (show) => {
              setHidden(!show);
              const { error } = await supabase().rpc("set_presence_hidden", { p_hidden: !show });
              if (error) setMessage({ tone: "danger", text: errorText(dbCode(error)) });
            }}
          />
        </View>
      </Card>

      <T weight="bold" style={{ fontSize: 17 }}>الإشعارات</T>
      <Card style={{ gap: 0 }}>
        {OPTIONAL.map((type, i) => (
          <View key={type} style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, borderTopWidth: i ? 1 : 0, borderTopColor: colors.line }}>
            <T style={{ flex: 1 }}>{st(`notificationTypes.${type}`)}</T>
            <Switch
              value={!muted.has(type)}
              accessibilityLabel={st(`notificationTypes.${type}`)}
              trackColor={{ true: colors.accentText, false: colors.lineStrong }}
              onValueChange={(on) => {
                const next = new Set(muted);
                if (on) next.delete(type);
                else next.add(type);
                void saveNotifications(next);
              }}
            />
          </View>
        ))}
      </Card>

      <T weight="bold" style={{ fontSize: 17 }}>المحظورون</T>
      <Card>
        {blocked.length === 0 ? <T muted>لم تحظر أحداً.</T> : null}
        {blocked.map((b) => (
          <View key={b.blocked_id} style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <Avatar uri={publicUrl("avatars", b.profile?.avatar_path)} name={b.profile?.display_name ?? "?"} size={40} />
            <T style={{ flex: 1 }}>{b.profile?.display_name}</T>
            <Button
              label="إلغاء الحظر"
              variant="ghost"
              onPress={async () => {
                await supabase().rpc("unblock_user", { p_user_id: b.blocked_id });
                await load();
              }}
            />
          </View>
        ))}
      </Card>
    </ScrollView>
  );
}
