import { useCallback, useState } from "react";
import { Alert, RefreshControl, ScrollView, View } from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../src/lib/auth";
import { dbCode, errorText } from "../src/lib/errors";
import { formatDateTime, formatPrice, formatTime } from "../src/lib/format";
import { supabase } from "../src/lib/supabase";
import { st } from "../src/lib/texts";
import { Badge, Button, Card, Empty, Field, Loading, Notice, T } from "../src/ui/kit";
import { useColors } from "../src/ui/theme";

interface Booking {
  id: string;
  status: string;
  starts_at: string;
  ends_at: string;
  price_total: number;
  currency: string;
  deposit_amount: number | null;
  deposit_status: string | null;
  deposit_reference: string | null;
  expires_at: string | null;
  field: { name: string } | null;
  venue: { id: string; name: string; deposit_instructions: string | null } | null;
}

/**
 * The member's bookings, as the site's «حجوزاتي»: those holding a time while
 * the deposit is on its way first (with how to pay and «أرسلت العربون»), then
 * the rest. Cancelling and reporting go to the database (cancel_booking,
 * report_booking_deposit), which says what is allowed.
 */
export default function Bookings() {
  const { session } = useAuth();
  const router = useRouter();
  const colors = useColors();
  const { booked } = useLocalSearchParams<{ booked?: string }>();
  const [rows, setRows] = useState<Booking[] | null>(null);
  const [chats, setChats] = useState<Map<string, string>>(new Map());
  const [refs, setRefs] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(booked ? { tone: "success", text: "تم إرسال الحجز. ستجده هنا مع حالته." } : null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!session) return;
    const db = supabase();
    const { data } = await db
      .from("bookings")
      .select("id, status, starts_at, ends_at, price_total, currency, deposit_amount, deposit_status, deposit_reference, expires_at, field:venue_fields(name), venue:venues(id, name, deposit_instructions)")
      .eq("requested_by", session.user.id)
      .order("starts_at", { ascending: false })
      .limit(100);
    const now = Date.now();
    // A hold past its time is released, as the database will say on its next check.
    const list = ((data ?? []) as unknown as Booking[]).map((b) =>
      b.status === "requested" && b.deposit_status && b.expires_at && Date.parse(b.expires_at) <= now ? { ...b, status: "expired" } : b,
    );
    const holding = list.filter((b) => b.status === "requested" && (b.deposit_status === "pending" || b.deposit_status === "reported"));
    setRows([...holding, ...list.filter((b) => !holding.includes(b))]);
    const { data: convs } = list.length ? await db.from("conversations").select("id, booking_id").in("booking_id", list.map((b) => b.id)) : { data: [] };
    setChats(new Map(((convs ?? []) as { id: string; booking_id: string }[]).map((c) => [c.booking_id, c.id])));
  }, [session]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const call = async (fn: string, args: Record<string, unknown>, done: string) => {
    setMessage(null);
    const { error } = await supabase().rpc(fn, args);
    if (error) return setMessage({ tone: "danger", text: errorText(dbCode(error)) });
    setMessage({ tone: "success", text: done });
    await load();
  };

  if (!rows) return <Loading />;
  return (
    <ScrollView
      contentContainerStyle={{ padding: 16, gap: 12, flexGrow: 1 }}
      refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.accentText} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
    >
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      {rows.length === 0 ? (
        <Empty title={st("bookings.noneMine")}>
          <Button label="ابحث عن ملعب" onPress={() => router.push("/venues")} />
        </Empty>
      ) : null}
      {rows.map((b) => {
        const awaiting = b.status === "requested" && b.deposit_status === "pending";
        const reported = b.status === "requested" && b.deposit_status === "reported";
        const active = ["requested", "confirmed"].includes(b.status) && Date.parse(b.starts_at) > Date.now();
        return (
          <Card key={b.id} style={awaiting ? { borderColor: colors.warning } : undefined}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <T weight="bold" style={{ fontSize: 16, flex: 1 }} numberOfLines={1}>{b.venue?.name ?? ""}</T>
              <Badge label={st(`bookings.status.${b.status}`)} tone={b.status === "confirmed" ? "accent" : b.status === "requested" ? "warning" : "neutral"} />
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Ionicons name="time-outline" size={16} color={colors.muted} />
              <T muted>{formatDateTime(b.starts_at)} – {formatTime(b.ends_at)}{b.field ? ` · ${b.field.name}` : ""}</T>
            </View>
            <T muted>{formatPrice(b.price_total, b.currency)}</T>
            {b.deposit_status ? <T style={{ fontSize: 13, color: colors.muted }}>{st(`bookings.depositStatus.${b.deposit_status}`)}</T> : null}

            {awaiting && b.deposit_amount ? (
              <View style={{ gap: 8, marginTop: 4 }}>
                <T weight="bold" style={{ color: colors.warning }}>{st("bookings.awaitingTitle")} · {st("bookings.depositAmount", { amount: formatPrice(b.deposit_amount, b.currency) })}</T>
                {b.expires_at ? <T muted>{st("bookings.sendBy", { time: formatDateTime(b.expires_at) })}</T> : null}
                {b.venue?.deposit_instructions ? (
                  <View style={{ backgroundColor: colors.surface2, borderRadius: 12, padding: 10 }}>
                    <T weight="semibold">{st("bookings.howToPay")}</T>
                    <T selectable>{b.venue.deposit_instructions}</T>
                  </View>
                ) : null}
                <Field label={st("bookings.referenceLabel")} hint={st("bookings.referenceHint")} value={refs[b.id] ?? ""} onChangeText={(v) => setRefs((r) => ({ ...r, [b.id]: v }))} maxLength={120} />
                <Button label={st("bookings.reportButton")} disabled={!(refs[b.id] ?? "").trim()} onPress={() => void call("report_booking_deposit", { p_booking_id: b.id, p_reference: (refs[b.id] ?? "").trim() }, "أخبرنا الملعب أنك أرسلت العربون.")} />
              </View>
            ) : null}
            {reported ? <T muted>{st("bookings.reported", { reference: b.deposit_reference ?? "" })}</T> : null}

            <View style={{ flexDirection: "row", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
              {chats.get(b.id) ? <Button label="مراسلة الملعب" variant="secondary" style={{ flex: 1 }} onPress={() => router.push(`/chat/${chats.get(b.id)}`)} /> : null}
              {active ? (
                <Button
                  label={st("bookings.cancel")}
                  variant="danger"
                  style={{ flex: 1 }}
                  onPress={() =>
                    Alert.alert(st("bookings.cancelTitle"), st("bookings.cancelCustomerNote"), [
                      { text: "تراجع", style: "cancel" },
                      { text: st("bookings.cancel"), style: "destructive", onPress: () => void call("cancel_booking", { p_booking_id: b.id }, "أُلغي الحجز.") },
                    ])
                  }
                />
              ) : null}
            </View>
          </Card>
        );
      })}
    </ScrollView>
  );
}
