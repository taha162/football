import { useCallback, useEffect, useRef, useState } from "react";
import { FlatList, RefreshControl, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../../src/lib/supabase";
import { Empty, Loading } from "../../src/ui/kit";
import { VenueCard, type VenueCardData as Venue } from "../../src/ui/venue-card";
import { fonts, useColors } from "../../src/ui/theme";


const PAGE = 20;

/** The venues, searched by name (as the site's «الملاعب»). */
export default function Venues() {
  const colors = useColors();
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
          refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.accentText} onRefresh={async () => { setRefreshing(true); await load(0, query); setRefreshing(false); }} />}
          ListEmptyComponent={<Empty title={query ? "لا ملاعب بهذا الاسم" : "لا ملاعب بعد"} />}
          renderItem={({ item }) => <VenueCard venue={item} />}
        />
      )}
    </View>
  );
}
