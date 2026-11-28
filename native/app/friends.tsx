import { useCallback, useState } from "react";
import { Pressable, RefreshControl, ScrollView, TextInput, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { errorText } from "../src/lib/errors";
import { friendAction, type Relation } from "../src/lib/people";
import { publicUrl, supabase } from "../src/lib/supabase";
import { Avatar, Button, Card, Empty, Loading, Notice, T } from "../src/ui/kit";
import { fonts, useColors } from "../src/ui/theme";

interface Person {
  user_id: string;
  display_name: string;
  username: string | null;
  avatar_path: string | null;
  relation: Relation;
}

/**
 * Friends, as the site's «الأصدقاء»: find someone by @username, answer the
 * requests that came in, see those sent, and the friends themselves.
 */
export default function Friends() {
  const router = useRouter();
  const colors = useColors();
  const [people, setPeople] = useState<Person[] | null>(null);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Person | null | undefined>(undefined);
  const [message, setMessage] = useState<{ tone: "danger" | "success"; text: string } | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase().rpc("my_friends");
    setPeople((data ?? []) as Person[]);
  }, []);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const search = async () => {
    const name = query.trim().replace(/^@+/, "");
    if (!name) return;
    const { data } = await supabase().rpc("find_member", { p_username: name });
    const row = ((data ?? []) as { id: string; display_name: string; username: string; avatar_path: string | null; relation: Relation }[])[0];
    setFound(row ? { user_id: row.id, display_name: row.display_name, username: row.username, avatar_path: row.avatar_path, relation: row.relation } : null);
  };

  const act = async (kind: Parameters<typeof friendAction>[0], p: Person, done: string) => {
    setMessage(null);
    const error = await friendAction(kind, { id: p.user_id, username: p.username });
    if (error) return setMessage({ tone: "danger", text: errorText(error) });
    setMessage({ tone: "success", text: done });
    setFound(undefined);
    await load();
  };

  if (!people) return <Loading />;
  const incoming = people.filter((p) => p.relation === "incoming");
  const sent = people.filter((p) => p.relation === "requested");
  const friends = people.filter((p) => p.relation === "friend");

  const Row = ({ p, children }: { p: Person; children?: React.ReactNode }) => (
    <Pressable onPress={() => router.push(`/player/${p.user_id}`)} style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8 }} accessibilityRole="button" accessibilityLabel={p.display_name}>
      <Avatar uri={publicUrl("avatars", p.avatar_path)} name={p.display_name} size={46} />
      <T weight="semibold" style={{ flex: 1 }} numberOfLines={1}>{p.display_name}</T>
      {children}
    </Pressable>
  );

  return (
    <ScrollView
      contentContainerStyle={{ padding: 16, gap: 14 }}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.accentText} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.surface, borderColor: colors.line, borderWidth: 1, borderRadius: 14, paddingHorizontal: 12 }}>
        <T style={{ color: colors.faint }}>@</T>
        <TextInput
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={search}
          placeholder="اسم مستخدم صديقك"
          placeholderTextColor={colors.faint}
          accessibilityLabel="اسم مستخدم صديقك"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          style={{ flex: 1, minHeight: 48, color: colors.ink, fontFamily: fonts.regular, fontSize: 16, textAlign: "left" }}
        />
        <Pressable onPress={search} accessibilityRole="button" accessibilityLabel="بحث" style={{ padding: 6 }}>
          <Ionicons name="search" size={20} color={colors.accentText} />
        </Pressable>
      </View>
      {found === null ? <Notice tone="info">{`لا يوجد عضو باسم المستخدم @${query.trim().replace(/^@+/, "")}.`}</Notice> : null}
      {found ? (
        <Card>
          <Row p={found}>
            {found.relation === "none" ? <Button label="إضافة صديق" onPress={() => void act("add", found, "تم إرسال الطلب.")} style={{ minHeight: 40 }} /> : null}
            {found.relation === "incoming" ? <Button label="قبول" onPress={() => void act("accept", found, "أصبحتما صديقين.")} style={{ minHeight: 40 }} /> : null}
            {found.relation === "requested" ? <T muted>تم إرسال الطلب</T> : null}
            {found.relation === "friend" ? <T style={{ color: colors.accentText }}>صديقك</T> : null}
          </Row>
        </Card>
      ) : null}
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}

      {incoming.length ? (
        <>
          <T weight="bold" style={{ fontSize: 17 }}>طلبات وصلتك ({incoming.length})</T>
          <Card>
            {incoming.map((p) => (
              <Row key={p.user_id} p={p}>
                <Button label="قبول" onPress={() => void act("accept", p, "أصبحتما صديقين.")} style={{ minHeight: 38, paddingHorizontal: 14 }} />
                <Button label="رفض" variant="ghost" onPress={() => void act("decline", p, "رُفض الطلب.")} style={{ minHeight: 38, paddingHorizontal: 10 }} />
              </Row>
            ))}
          </Card>
        </>
      ) : null}

      <T weight="bold" style={{ fontSize: 17 }}>أصدقاؤك ({friends.length})</T>
      {friends.length ? (
        <Card>
          {friends.map((p) => (
            <Row key={p.user_id} p={p}>
              <Ionicons name="chevron-back" size={18} color={colors.faint} />
            </Row>
          ))}
        </Card>
      ) : (
        <Empty title="لا أصدقاء بعد"><T muted style={{ textAlign: "center" }}>ابحث عن صديقك باسم المستخدم في الأعلى.</T></Empty>
      )}

      {sent.length ? (
        <>
          <T weight="bold" style={{ fontSize: 17 }}>طلبات أرسلتها ({sent.length})</T>
          <Card>
            {sent.map((p) => (
              <Row key={p.user_id} p={p}>
                <Button label="إلغاء" variant="ghost" onPress={() => void act("cancel", p, "أُلغي الطلب.")} style={{ minHeight: 38, paddingHorizontal: 10 }} />
              </Row>
            ))}
          </Card>
        </>
      ) : null}
    </ScrollView>
  );
}
