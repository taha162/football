import { useCallback, useEffect, useRef, useState } from "react";
import { FlatList, RefreshControl, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { formatPrice } from "../../src/lib/format";
import { publicUrl, supabase } from "../../src/lib/supabase";
import { Badge, Card, Empty, Loading, T } from "../../src/ui/kit";
import { colors, fonts } from "../../src/ui/theme";

interface Venue {
  id: string;
  name: string;
  cover_image_path: string | null;
  booking_mode: string;
  verification_status: string;
  city: { name_ar: string } | null;
  area: { name_ar: string } | null;
  fields: { price_per_hour: number; is_active: boolean }[];
}

const PAGE = 20;

/** The venues, searched by name (as the site's «الملاعب»). */
export default function Venues() {
  const router = useRouter();
  const [items, setItems] = useState<Venue[] | null>(null);
  const [page, setPage] = useState(0);
  const [more, setMore] = useState(false);
  const [query, setQuery] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const loading = useRef(false);

  const load = useCallback(async (next: number, q: string) => {
    if (loading.current) return;
    loading.current = true;
    let request = supabase()
      .from("venues")
      .select("id, name, cover_image_path, booking_mode, verification_status, city:cities(name_ar), area:areas(name_ar), fields:venue_fields(price_per_hour, is_active)")
      .eq("is_hidden", false)
      .order("verification_status", { ascending: false })
      .order("name")
      .order("id")
      .range(next * PAGE, next * PAGE + PAGE);
    if (q.trim()) request = request.ilike("name", `%${q.trim().replace(/[%_\\]/g, "")}%`);
    const { data } = await request;
    const rows = (data ?? []) as unknown as Venue[];
    setItems((prev) => (next === 0 ? rows.slice(0, PAGE) : [...(prev ?? []), ...rows.slice(0, PAGE)]));
    setMore(rows.length > PAGE);
    setPage(next);
    loading.current = false;
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void load(0, query), query ? 350 : 0);
    return () => clearTimeout(t);
  }, [query, load]);

  return (
    <View style={{ flex: 1 }}>
      <View style={{ padding: 12, paddingBottom: 4 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.surface2, borderColor: colors.line, borderWidth: 1, borderRadius: 14, paddingHorizontal: 12 }}>
          <Ionicons name="search" size={18} color={colors.muted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="ابحث باسم الملعب"
            placeholderTextColor={colors.faint}
            accessibilityLabel="ابحث باسم الملعب"
            style={{ flex: 1, minHeight: 46, color: colors.ink, fontFamily: fonts.regular, fontSize: 16, textAlign: "left" }}
          />
        </View>
      </View>
      {!items ? (
        <Loading />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(v) => v.id}
          numColumns={2}
          columnWrapperStyle={{ gap: 12 }}
          contentContainerStyle={{ padding: 12, gap: 12, flexGrow: 1 }}
          onEndReachedThreshold={0.4}
          onEndReached={() => {
            if (more) void load(page + 1, query);
          }}
          refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.accent} onRefresh={async () => { setRefreshing(true); await load(0, query); setRefreshing(false); }} />}
          ListEmptyComponent={<Empty title={query ? "لا ملاعب بهذا الاسم" : "لا ملاعب بعد"} />}
          renderItem={({ item }) => {
            const prices = item.fields.filter((f) => f.is_active).map((f) => f.price_per_hour);
            const cover = publicUrl("venue-images", item.cover_image_path);
            return (
              <Card onPress={() => router.push(`/venue/${item.id}`)} style={{ flex: 1, padding: 0, overflow: "hidden", gap: 0 }}>
                <View style={{ aspectRatio: 4 / 3, backgroundColor: "#1f6b3a" }}>
                  {cover ? <Image source={cover} style={{ flex: 1 }} contentFit="cover" transition={150} accessibilityLabel={item.name} /> : null}
                </View>
                <View style={{ padding: 10, gap: 4 }}>
                  <T weight="bold" numberOfLines={1}>{item.name}</T>
                  <T muted numberOfLines={1} style={{ fontSize: 13 }}>{item.area?.name_ar ?? item.city?.name_ar ?? ""}</T>
                  {prices.length ? <T style={{ fontSize: 13 }}>من {formatPrice(Math.min(...prices))} / ساعة</T> : null}
                  {item.booking_mode === "platform" && item.verification_status === "verified" ? <Badge label="حجز من الموقع" tone="accent" /> : null}
                </View>
              </Card>
            );
          }}
        />
      )}
    </View>
  );
}
