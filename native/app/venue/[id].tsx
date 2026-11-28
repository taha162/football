import { useCallback, useState } from "react";
import { Linking, ScrollView, View } from "react-native";
import { useFocusEffect, useLocalSearchParams, useNavigation } from "expo-router";
import { Image } from "expo-image";
import * as WebBrowser from "expo-web-browser";
import { Ionicons } from "@expo/vector-icons";
import { SITE_URL } from "../../src/lib/config";
import { formatPrice } from "../../src/lib/format";
import { publicUrl, supabase } from "../../src/lib/supabase";
import { Button, Card, Empty, Loading, T } from "../../src/ui/kit";
import { MatchCard } from "../../src/ui/match-card";
import { PitchArt } from "../../src/ui/pitch-art";
import { MATCH_CARD, type MatchCard as Match } from "../../src/lib/matches";
import { useColors } from "../../src/ui/theme";

interface Venue {
  id: string;
  name: string;
  description: string | null;
  address: string | null;
  phone: string | null;
  whatsapp: string | null;
  latitude: number | null;
  longitude: number | null;
  cover_image_path: string | null;
  booking_mode: string;
  verification_status: string;
  city: { name_ar: string } | null;
  area: { name_ar: string } | null;
  fields: { id: string; name: string; price_per_hour: number; is_active: boolean; formats: string[] }[];
  hours: { weekday: number; opens: string; closes: string }[];
}

const DAYS = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const hhmm = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "ص" : "م"}`;
};

/** A venue: its courts and prices, opening hours, coming matches, and how to reach or book it. */
export default function VenueScreen() {
  const colors = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const navigation = useNavigation();
  const [venue, setVenue] = useState<Venue | null | undefined>(undefined);
  const [matches, setMatches] = useState<Match[]>([]);

  const load = useCallback(async () => {
    const db = supabase();
    const [{ data: v }, { data: m }] = await Promise.all([
      db.from("venues")
        .select("id, name, description, address, phone, whatsapp, latitude, longitude, cover_image_path, booking_mode, verification_status, city:cities(name_ar), area:areas(name_ar), fields:venue_fields(id, name, price_per_hour, is_active, formats), hours:venue_opening_hours(weekday, opens, closes)")
        .eq("id", id)
        .maybeSingle(),
      db.from("matches").select(MATCH_CARD).eq("venue_id", id).in("status", ["open", "full", "confirmed"]).gt("starts_at", new Date().toISOString()).order("starts_at").limit(10),
    ]);
    setVenue((v as unknown as Venue | null) ?? null);
    setMatches((m ?? []) as unknown as Match[]);
    if (v) navigation.setOptions({ title: (v as { name: string }).name });
  }, [id, navigation]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (venue === undefined) return <Loading />;
  if (venue === null) return <Empty title="لم نجد هذا الملعب" />;
  const cover = publicUrl("venue-images", venue.cover_image_path);
  const bookable = venue.booking_mode === "platform" && venue.verification_status === "verified";
  const hours = [...venue.hours].sort((a, b) => a.weekday - b.weekday);

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
      <View style={{ aspectRatio: 16 / 9, overflow: "hidden" }}>
        {cover ? <Image source={cover} style={{ flex: 1 }} contentFit="cover" accessibilityLabel={venue.name} /> : <PitchArt />}
      </View>
      <View style={{ padding: 16, gap: 14 }}>
        <View style={{ gap: 4 }}>
          <T weight="bold" style={{ fontSize: 24 }}>{venue.name}</T>
          <T muted>{[venue.address, venue.area?.name_ar ?? venue.city?.name_ar].filter(Boolean).join("، ")}</T>
        </View>
        {bookable ? (
          // Booking (times, courts, the deposit) is on the site for now; it opens here.
          <Button label="احجز موعداً" onPress={() => void WebBrowser.openBrowserAsync(`${SITE_URL}/ar/venues/${venue.id}/book`)} />
        ) : null}
        <View style={{ flexDirection: "row", gap: 10 }}>
          {venue.phone ? <Button label="اتصال" variant="secondary" style={{ flex: 1 }} onPress={() => void Linking.openURL(`tel:${venue.phone}`)} /> : null}
          {venue.latitude != null && venue.longitude != null ? (
            <Button label="الاتجاهات" variant="secondary" style={{ flex: 1 }} onPress={() => void Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${venue.latitude},${venue.longitude}`)} />
          ) : null}
        </View>
        {venue.description ? <T muted>{venue.description}</T> : null}

        {venue.fields.some((f) => f.is_active) ? (
          <>
            <T weight="bold" style={{ fontSize: 18 }}>الملاعب والأسعار</T>
            <Card>
              {venue.fields.filter((f) => f.is_active).map((f) => (
                <View key={f.id} style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 }}>
                  <T>{f.name}{f.formats.length ? ` · ${f.formats.map((x) => x.replace("v", "×")).join("، ")}` : ""}</T>
                  <T weight="semibold">{formatPrice(f.price_per_hour)} / ساعة</T>
                </View>
              ))}
            </Card>
          </>
        ) : null}

        {hours.length ? (
          <>
            <T weight="bold" style={{ fontSize: 18 }}>أوقات الدوام</T>
            <Card>
              {hours.map((h) => (
                <View key={`${h.weekday}-${h.opens}`} style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 }}>
                  <T>{DAYS[h.weekday]}</T>
                  <T muted>{hhmm(h.opens)} – {hhmm(h.closes)}</T>
                </View>
              ))}
            </Card>
          </>
        ) : null}

        {matches.length ? (
          <>
            <T weight="bold" style={{ fontSize: 18 }}>مباريات قادمة هنا</T>
            {matches.map((m) => (
              <MatchCard key={m.id} match={m} />
            ))}
          </>
        ) : null}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, opacity: 0.8 }}>
          <Ionicons name="information-circle-outline" size={16} color={colors.muted} />
          <T muted style={{ fontSize: 13, flex: 1 }}>الحجز يُفتح في صفحة الموقع داخل التطبيق.</T>
        </View>
      </View>
    </ScrollView>
  );
}
