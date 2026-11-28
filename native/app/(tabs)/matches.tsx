import { useCallback, useEffect, useRef, useState } from "react";
import { FlatList, Pressable, RefreshControl, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { errorText, dbCode } from "../../src/lib/errors";
import { searchMatches, type MatchCard as Match } from "../../src/lib/matches";
import { Empty, Loading, Notice, T } from "../../src/ui/kit";
import { MatchCard } from "../../src/ui/match-card";
import { fonts, useColors } from "../../src/ui/theme";

/** Upcoming matches the member may join, soonest first, with a search by name; and organising a new one. */
export default function Matches() {
  const colors = useColors();
  const router = useRouter();
  const [items, setItems] = useState<Match[] | null>(null);
  const [more, setMore] = useState(false);
  const [page, setPage] = useState(0);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const loading = useRef(false);

  const load = useCallback(async (next: number, q: string) => {
    if (loading.current) return;
    loading.current = true;
    try {
      const res = await searchMatches(next, q.trim() || undefined);
      setItems((prev) => (next === 0 ? res.items : [...(prev ?? []), ...res.items]));
      setMore(res.more);
      setPage(next);
      setError(null);
    } catch (e) {
      setError(dbCode(e as { message?: string; code?: string }));
      if (next === 0) setItems([]);
    } finally {
      loading.current = false;
    }
  }, []);

  // A search waits for the typing to pause.
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
            placeholder="ابحث باسم المباراة"
            placeholderTextColor={colors.faint}
            accessibilityLabel="ابحث باسم المباراة"
            returnKeyType="search"
            style={{ flex: 1, minHeight: 46, color: colors.ink, fontFamily: fonts.regular, fontSize: 16, textAlign: "left" }}
          />
          <Pressable
            onPress={() => router.push("/new-match")}
            accessibilityRole="button"
            accessibilityLabel="مباراة جديدة"
            hitSlop={6}
            style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.accent, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7, opacity: pressed ? 0.8 : 1 })}
          >
            <Ionicons name="add" size={18} color={colors.accentInk} />
            <T weight="bold" style={{ color: colors.accentInk, fontSize: 13 }}>جديدة</T>
          </Pressable>
        </View>
      </View>
      {error ? (
        <View style={{ padding: 12 }}>
          <Notice tone="danger">{errorText(error)}</Notice>
        </View>
      ) : null}
      {!items ? (
        <Loading />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ padding: 12, gap: 12, flexGrow: 1 }}
          renderItem={({ item }) => <MatchCard match={item} />}
          onEndReachedThreshold={0.4}
          onEndReached={() => {
            if (more) void load(page + 1, query);
          }}
          refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.accentText} onRefresh={async () => { setRefreshing(true); await load(0, query); setRefreshing(false); }} />}
          ListEmptyComponent={<Empty title={query ? "لا مباريات بهذا الاسم" : "لا مباريات قادمة الآن"}><T muted style={{ textAlign: "center" }}>اسحب للأسفل للتحديث.</T></Empty>}
        />
      )}
    </View>
  );
}
