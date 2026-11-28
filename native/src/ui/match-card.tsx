import { View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { formatDateTime, formatPrice } from "../lib/format";
import { formatLabel, openSpots, STATUS, type MatchCard as Match } from "../lib/matches";
import { Badge, Card, T } from "./kit";
import { colors } from "./theme";

export function MatchCard({ match }: { match: Match }) {
  const router = useRouter();
  const left = openSpots(match);
  const place = [match.venue?.name, match.area?.name_ar ?? match.city?.name_ar].filter(Boolean).join("، ");
  return (
    <Card onPress={() => router.push(`/match/${match.id}`)}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <T weight="bold" style={{ fontSize: 17, flex: 1 }} numberOfLines={1}>{match.title}</T>
        <Badge label={formatLabel(match.format)} tone="accent" />
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Ionicons name="time-outline" size={16} color={colors.muted} />
        <T muted>{formatDateTime(match.starts_at)}</T>
      </View>
      {place ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Ionicons name="location-outline" size={16} color={colors.muted} />
          <T muted numberOfLines={1} style={{ flex: 1 }}>{place}</T>
        </View>
      ) : null}
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
        <T weight="semibold" style={{ color: left > 0 ? colors.accent : colors.warning }}>
          {match.status === "open" && left > 0 ? `${left} أماكن متاحة` : STATUS[match.status] ?? match.status}
        </T>
        <T muted>{formatPrice(match.price_per_player, match.currency)}</T>
      </View>
    </Card>
  );
}
