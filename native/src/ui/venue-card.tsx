import { StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { formatPrice } from "../lib/format";
import { publicUrl } from "../lib/supabase";
import { Card, T } from "./kit";
import { PitchArt } from "./pitch-art";
import { useColors } from "./theme";

export interface VenueCardData {
  id: string;
  name: string;
  cover_image_path: string | null;
  booking_mode: string;
  verification_status: string;
  city: { name_ar: string } | null;
  area: { name_ar: string } | null;
  fields: { price_per_hour: number; is_active: boolean }[];
}

/**
 * A venue as a tall picture card: its photo (or a drawn pitch) under a
 * shade, the name and area on it, the lowest price in a lime tag, and a tick
 * when it takes bookings on the site.
 */
export function VenueCard({ venue }: { venue: VenueCardData }) {
  const router = useRouter();
  const colors = useColors();
  const prices = venue.fields.filter((f) => f.is_active).map((f) => f.price_per_hour);
  const courts = venue.fields.filter((f) => f.is_active).length;
  const cover = publicUrl("venue-images", venue.cover_image_path);
  const bookable = venue.booking_mode === "platform" && venue.verification_status === "verified";
  return (
    <Card onPress={() => router.push(`/venue/${venue.id}`)} label={venue.name} style={{ flex: 1, padding: 0, overflow: "hidden", gap: 0, aspectRatio: 3 / 4 }}>
      {cover ? <Image source={cover} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} /> : <PitchArt compact />}
      <LinearGradient colors={["transparent", "rgba(0,0,0,0.25)", "rgba(0,0,0,0.85)"]} locations={[0.35, 0.6, 1]} style={StyleSheet.absoluteFill} />
      <View style={{ flexDirection: "row", justifyContent: "space-between", padding: 10 }}>
        {prices.length ? (
          <View style={{ backgroundColor: colors.accent, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 2 }}>
            <T weight="bold" style={{ color: colors.accentInk, fontSize: 12 }}>من {formatPrice(Math.min(...prices))}</T>
          </View>
        ) : <View />}
        {bookable ? (
          <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: "#ffffffee", alignItems: "center", justifyContent: "center" }} accessibilityLabel="يقبل الحجز من التطبيق">
            <Ionicons name="calendar" size={14} color="#1d5e32" />
          </View>
        ) : null}
      </View>
      <View style={{ marginTop: "auto", padding: 12, gap: 2 }}>
        <T weight="bold" style={{ color: "#ffffff", fontSize: 16 }} numberOfLines={2}>{venue.name}</T>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <Ionicons name="location" size={12} color="#ffffffcc" />
          <T style={{ color: "#ffffffcc", fontSize: 12, flex: 1 }} numberOfLines={1}>{venue.area?.name_ar ?? venue.city?.name_ar ?? ""}</T>
        </View>
        {courts > 1 ? <T style={{ color: "#ffffffaa", fontSize: 11 }}>{courts} ملاعب</T> : null}
      </View>
    </Card>
  );
}
