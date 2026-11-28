import { StyleSheet, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useColors } from "./theme";

/** A pitch seen from above (stripes, lines, centre circle): a venue without a photo, or a card's backdrop. */
export function PitchArt({ compact }: { compact?: boolean }) {
  const colors = useColors();
  const line = "rgba(255,255,255,0.55)";
  return (
    <LinearGradient colors={[colors.pitch, colors.pitchDeep]} style={StyleSheet.absoluteFill} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
      {/* Mown stripes. */}
      <View style={[StyleSheet.absoluteFill, { flexDirection: "row" }]}>
        {Array.from({ length: 6 }, (_, i) => (
          <View key={i} style={{ flex: 1, backgroundColor: i % 2 ? "rgba(255,255,255,0.05)" : "transparent" }} />
        ))}
      </View>
      <View style={{ position: "absolute", top: 10, bottom: 10, left: 10, right: 10, borderWidth: 1.5, borderColor: line, borderRadius: 4 }} />
      <View style={{ position: "absolute", top: 10, bottom: 10, left: "50%", width: 1.5, backgroundColor: line }} />
      <View style={{ position: "absolute", top: "50%", left: "50%", width: compact ? 34 : 54, height: compact ? 34 : 54, marginTop: compact ? -17 : -27, marginLeft: compact ? -17 : -27, borderRadius: 40, borderWidth: 1.5, borderColor: line }} />
      <View style={{ position: "absolute", top: "30%", bottom: "30%", left: 10, width: compact ? 14 : 22, borderWidth: 1.5, borderLeftWidth: 0, borderColor: line }} />
      <View style={{ position: "absolute", top: "30%", bottom: "30%", right: 10, width: compact ? 14 : 22, borderWidth: 1.5, borderRightWidth: 0, borderColor: line }} />
    </LinearGradient>
  );
}
