import { useCallback, useState } from "react";
import { RefreshControl, ScrollView, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useAuth } from "../../src/lib/auth";
import { myUpcomingMatches, type MatchCard as Match } from "../../src/lib/matches";
import { supabase } from "../../src/lib/supabase";
import { Button, Card, Loading, T } from "../../src/ui/kit";
import { MatchCard } from "../../src/ui/match-card";
import { PitchArt } from "../../src/ui/pitch-art";
import { useColors } from "../../src/ui/theme";

/** Home: the member's coming matches, and what waits for them. */
export default function Home() {
  const colors = useColors();
  const { profile, session } = useAuth();
  const router = useRouter();
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [invitations, setInvitations] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!session) return;
    const [mine, invites] = await Promise.all([
      myUpcomingMatches(session.user.id),
      supabase().from("match_invitations").select("id", { count: "exact", head: true }).eq("invitee_id", session.user.id).eq("status", "pending"),
    ]);
    setMatches(mine);
    setInvitations(invites.count ?? 0);
  }, [session]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (!matches) return <Loading />;
  return (
    <ScrollView
      contentContainerStyle={{ padding: 16, gap: 14 }}
      refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.accentText} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
    >
      {/* A pitch at kick-off: the greeting, and how many matches are coming. */}
      <View style={{ borderRadius: 24, overflow: "hidden", minHeight: 150, justifyContent: "flex-end" }}>
        <PitchArt />
        <View style={{ padding: 18, gap: 2 }}>
          <T weight="semibold" style={{ color: "#ffffffcc" }}>أهلاً</T>
          <T weight="bold" style={{ fontSize: 26, color: "#ffffff" }} numberOfLines={1}>{profile?.display_name ?? ""}</T>
          <T weight="semibold" style={{ color: colors.accent }}>{matches.length ? `${matches.length === 1 ? "مباراة واحدة" : `${matches.length} مباريات`} قادمة` : "لا مباريات قادمة بعد"}</T>
        </View>
      </View>
      {invitations > 0 ? (
        <Card style={{ borderColor: `${colors.accent}55` }}>
          <T weight="semibold">لديك {invitations === 1 ? "دعوة واحدة" : `${invitations} دعوات`} إلى مباريات.</T>
          <T muted>افتح «المباريات» لتراها.</T>
        </Card>
      ) : null}
      <T weight="bold" style={{ fontSize: 18, marginTop: 4 }}>مبارياتك القادمة</T>
      {matches.length === 0 ? (
        <Card>
          <T muted>لا مباريات قادمة لك بعد.</T>
          <Button label="ابحث عن مباراة" onPress={() => router.push("/matches")} style={{ marginTop: 6 }} />
        </Card>
      ) : (
        <View style={{ gap: 12 }}>
          {matches.map((m) => (
            <MatchCard key={m.id} match={m} />
          ))}
        </View>
      )}
    </ScrollView>
  );
}
