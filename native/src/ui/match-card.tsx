import { View } from "react-native";
import { useRouter } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { dateParts, formatPrice } from "../lib/format";
import { formatLabel, openSpots, STATUS, type MatchCard as Match } from "../lib/matches";
import { Card, T } from "./kit";
import { useColors } from "./theme";

/**
 * A match as a ticket: the date stub on the side (the day large, the time
 * under it), a perforated tear line, then the match. One seat per player
 * shows how full it is at a glance; the last places say so.
 */
export function MatchCard({ match }: { match: Match }) {
  const router = useRouter();
  const colors = useColors();
  const date = dateParts(match.starts_at);
  const seats = Math.max(0, match.total_players - match.reserved_spots);
  const taken = Math.min(seats, match.confirmed_count);
  const left = openSpots(match);
  const place = [match.venue?.name, match.area?.name_ar ?? match.city?.name_ar].filter(Boolean).join("، ");
  const open = match.status === "open" && left > 0;
  const state = open ? (left <= 2 ? `آخر ${left === 1 ? "مكان" : "مكانين"}!` : `${left} أماكن متاحة`) : STATUS[match.status] ?? match.status;
  const stateColor = open ? (left <= 2 ? colors.warning : colors.accentText) : colors.muted;

  return (
    <Card onPress={() => router.push(`/match/${match.id}`)} label={`${match.title}، ${date.weekday} ${date.time}، ${state}`} style={{ padding: 0, flexDirection: "row", overflow: "hidden", gap: 0 }}>
      {/* The stub. */}
      <LinearGradient colors={[colors.pitch, colors.pitchDeep]} style={{ width: 92, alignItems: "center", justifyContent: "center", paddingVertical: 14, gap: 0 }}>
        <T weight="semibold" style={{ color: "#ffffffcc", fontSize: 12 }}>{date.weekday}</T>
        <T weight="bold" style={{ color: colors.accent, fontSize: 34, lineHeight: 44 }}>{date.day}</T>
        <T weight="semibold" style={{ color: "#ffffff", fontSize: 12 }}>{date.month}</T>
        <View style={{ marginTop: 6, backgroundColor: "#00000033", borderRadius: 999, paddingHorizontal: 8, paddingVertical: 1 }}>
          <T weight="bold" style={{ color: "#ffffff", fontSize: 12 }}>{date.time}</T>
        </View>
      </LinearGradient>
      {/* The tear line: a dotted edge with a notch at each end, wherever the stub sits. */}
      <View style={{ width: 0, alignItems: "center" }}>
        <View style={{ position: "absolute", top: -9, width: 18, height: 18, borderRadius: 9, backgroundColor: colors.bg }} />
        <View style={{ flex: 1, width: 0, borderStyle: "dashed", borderLeftWidth: 1.5, borderColor: colors.lineStrong, marginVertical: 14 }} />
        <View style={{ position: "absolute", bottom: -9, width: 18, height: 18, borderRadius: 9, backgroundColor: colors.bg }} />
      </View>
      <View style={{ flex: 1, padding: 14, gap: 6 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <T weight="bold" style={{ fontSize: 16, flex: 1 }} numberOfLines={1}>{match.title}</T>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: colors.surface2, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 1 }}>
            <Ionicons name="football" size={12} color={colors.muted} />
            <T weight="semibold" style={{ fontSize: 12, color: colors.muted }}>{formatLabel(match.format)}</T>
          </View>
        </View>
        {place ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <Ionicons name="location" size={13} color={colors.faint} />
            <T muted numberOfLines={1} style={{ flex: 1, fontSize: 13 }}>{place}</T>
          </View>
        ) : null}
        {seats > 0 ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 2 }} accessibilityLabel={`${taken} من ${seats} لاعباً`}>
            {Array.from({ length: Math.min(seats, 22) }, (_, i) => (
              <View key={i} style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: i < taken ? colors.accentText : "transparent", borderWidth: 1.5, borderColor: i < taken ? colors.accentText : colors.lineStrong }} />
            ))}
          </View>
        ) : null}
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 2 }}>
          <T weight="bold" style={{ color: stateColor, fontSize: 13 }}>{state}</T>
          <T weight="semibold" style={{ fontSize: 13 }}>{formatPrice(match.price_per_player, match.currency)}</T>
        </View>
      </View>
    </Card>
  );
}
