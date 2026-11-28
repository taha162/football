import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { useAuth } from "../../src/lib/auth";
import { dbCode, errorText } from "../../src/lib/errors";
import { clock, comingDays, formatDateTime, formatPrice } from "../../src/lib/format";
import { supabase } from "../../src/lib/supabase";
import { st } from "../../src/lib/texts";
import { Button, Card, Empty, Field, Loading, Notice, T } from "../../src/ui/kit";
import { useColors } from "../../src/ui/theme";

interface Venue {
  id: string;
  name: string;
  booking_mode: string;
  verification_status: string;
  deposit_instructions: string | null;
  auto_confirm_bookings: boolean;
  cancellation_deadline_hours: number;
  fields: { id: string; name: string; is_active: boolean }[];
  hours: { weekday: number }[];
}
interface Quote {
  price_total: number;
  currency: string;
  available: boolean;
  conflict: "mine" | "held" | "closed" | "booked" | "gap" | null;
  held_until: string | null;
  gap_minutes: number;
  deposit_amount: number | null;
  deposit_hold_minutes: number;
}

const DURATIONS = [60, 90, 120, 150, 180];

/**
 * Booking a venue, as on the site's booking page: the court (when there are
 * several), the day, how long, then only the times that are really free
 * (free_start_times). Choosing one shows its price (quote_booking); booking it
 * sends the request (request_booking). The database decides everything.
 */
export default function Book() {
  const { venue: venueId } = useLocalSearchParams<{ venue: string }>();
  const { session } = useAuth();
  const router = useRouter();
  const navigation = useNavigation();
  const colors = useColors();
  const days = comingDays(14);
  const [venue, setVenue] = useState<Venue | null | undefined>(undefined);
  const [depositsOn, setDepositsOn] = useState(false);
  const [pending, setPending] = useState({ count: 0, max: 5 });
  const [field, setField] = useState<string | null>(null);
  const [date, setDate] = useState(days[0].date);
  const [duration, setDuration] = useState(60);
  const [free, setFree] = useState<string[] | null>(null);
  const [time, setTime] = useState<string | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scroller = useRef<ScrollView>(null);

  useEffect(() => {
    void (async () => {
      const db = supabase();
      const [{ data: v }, { data: settings }, { count }] = await Promise.all([
        db.from("venues").select("id, name, booking_mode, verification_status, deposit_instructions, auto_confirm_bookings, cancellation_deadline_hours, fields:venue_fields(id, name, is_active), hours:venue_opening_hours(weekday)").eq("id", venueId).maybeSingle(),
        db.from("platform_settings").select("key, value").eq("is_public", true).in("key", ["booking.deposit_amount", "booking.max_pending_per_user"]),
        session
          ? db.from("bookings").select("id", { count: "exact", head: true }).eq("requested_by", session.user.id).eq("status", "requested").or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
          : Promise.resolve({ count: 0 }),
      ]);
      const value = (key: string, fallback: number) => {
        const n = Number((settings ?? []).find((s: { key: string }) => s.key === key)?.value);
        return Number.isFinite(n) ? n : fallback;
      };
      const max = value("booking.max_pending_per_user", 5);
      setDepositsOn(value("booking.deposit_amount", 5000) > 0);
      setPending({ count: count ?? 0, max: max > 0 ? max : 5 });
      const found = (v as unknown as Venue | null) ?? null;
      setVenue(found);
      setField(found?.fields.find((f) => f.is_active)?.id ?? null);
      if (found) navigation.setOptions({ title: `حجز ${found.name}` });
    })();
  }, [venueId, session, navigation]);

  // The free start times for this court, day and length.
  const loadFree = useCallback(async () => {
    if (!field) return;
    setFree(null);
    setTime(null);
    setQuote(null);
    const { data } = await supabase().rpc("free_start_times", { p_field_id: field, p_local_date: date, p_duration_minutes: duration });
    setFree(((data ?? []) as { start_local: string }[]).map((r) => r.start_local.slice(0, 5)));
  }, [field, date, duration]);
  useEffect(() => {
    void loadFree();
  }, [loadFree]);

  const choose = async (start: string) => {
    setTime(start);
    setQuote(null);
    setError(null);
    const { data, error: e } = await supabase().rpc("quote_booking", { p_field_id: field, p_start_local: `${date} ${start}`, p_duration_minutes: duration });
    if (e) return setError(errorText(dbCode(e)));
    setQuote(data as Quote);
    // The price and the button come under the times: bring them into view.
    setTimeout(() => scroller.current?.scrollToEnd({ animated: true }), 150);
  };

  const book = async () => {
    if (!field || !time) return;
    setBusy(true);
    setError(null);
    const { error: e } = await supabase().rpc("request_booking", { p_field_id: field, p_start_local: `${date} ${time}`, p_duration_minutes: duration, p_note: note.trim() || null });
    setBusy(false);
    if (e) return setError(errorText(dbCode(e)));
    router.replace({ pathname: "/bookings", params: { booked: "1" } });
  };

  if (venue === undefined) return <Loading />;
  if (venue === null) return <Empty title="لم نجد هذا الملعب" />;
  const bookable = venue.booking_mode === "platform" && venue.verification_status === "verified" && (!depositsOn || Boolean(venue.deposit_instructions?.trim()));
  if (!bookable) return <Empty title={st("booking.notBookableTitle")}><T muted style={{ textAlign: "center" }}>{st("booking.notBookableBody")}</T></Empty>;
  if (!venue.hours.length) return <Empty title={st("booking.noHoursTitle")}><T muted style={{ textAlign: "center" }}>{st("booking.noHoursBody")}</T></Empty>;
  const courts = venue.fields.filter((f) => f.is_active);
  const atLimit = pending.count >= pending.max;
  const deposit = quote?.deposit_amount ?? null;

  const chip = (on: boolean) => ({
    borderRadius: 14,
    borderWidth: 1,
    borderColor: on ? colors.accentText : colors.line,
    backgroundColor: on ? `${colors.accent}33` : colors.surface,
    paddingHorizontal: 14,
    paddingVertical: 8,
    alignItems: "center" as const,
  });

  return (
    <ScrollView ref={scroller} contentContainerStyle={{ padding: 16, gap: 16 }} keyboardShouldPersistTaps="handled">
      {atLimit ? <Notice tone="warning">{`${st("booking.pendingLimitTitle", { count: pending.count })}. ${st("booking.pendingLimitBody")}`}</Notice> : null}

      {courts.length > 1 ? (
        <View style={{ gap: 8 }}>
          <T weight="bold">{st("booking.field")}</T>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {courts.map((f) => (
              <Pressable key={f.id} onPress={() => setField(f.id)} style={chip(field === f.id)} accessibilityRole="radio" accessibilityState={{ checked: field === f.id }}>
                <T weight="semibold">{f.name}</T>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

      <View style={{ gap: 8 }}>
        <T weight="bold">{st("booking.date")}</T>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {days.map((d) => (
            <Pressable key={d.date} onPress={() => setDate(d.date)} style={[chip(date === d.date), { width: 64, paddingHorizontal: 0 }]} accessibilityRole="radio" accessibilityState={{ checked: date === d.date }} accessibilityLabel={`${d.weekday} ${d.day} ${d.month}`}>
              <T muted style={{ fontSize: 12 }}>{d.weekday}</T>
              <T weight="bold" style={{ fontSize: 20 }}>{d.day}</T>
              <T muted style={{ fontSize: 11 }}>{d.month}</T>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      <View style={{ gap: 8 }}>
        <T weight="bold">{st("booking.duration")}</T>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {DURATIONS.map((m) => (
            <Pressable key={m} onPress={() => setDuration(m)} style={chip(duration === m)} accessibilityRole="radio" accessibilityState={{ checked: duration === m }}>
              <T weight="semibold">{m === 60 ? "ساعة" : m === 120 ? "ساعتان" : m === 180 ? "3 ساعات" : `${m} دقيقة`}</T>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={{ gap: 8 }}>
        <T weight="bold">الأوقات المتاحة</T>
        {free === null ? (
          <ActivityIndicator color={colors.accentText} />
        ) : free.length === 0 ? (
          <T muted>{st("booking.freeNone")}</T>
        ) : (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {free.map((start) => (
              <Pressable key={start} onPress={() => void choose(start)} style={[chip(time === start), { minWidth: 86 }]} accessibilityRole="radio" accessibilityState={{ checked: time === start }}>
                <T weight="bold">{clock(start)}</T>
              </Pressable>
            ))}
          </View>
        )}
      </View>

      {error ? <Notice tone="danger">{error}</Notice> : null}

      {quote ? (
        quote.available ? (
          <Card style={{ borderColor: colors.accentText }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <T weight="bold">{st("booking.price")}</T>
              <T weight="bold" style={{ fontSize: 18 }}>{formatPrice(quote.price_total, quote.currency)}</T>
            </View>
            {deposit ? (
              <View style={{ gap: 6, marginTop: 4 }}>
                <T weight="bold">{st("booking.depositTitle")}: {formatPrice(deposit, quote.currency)}</T>
                <T muted>{st("booking.depositNote", { minutes: quote.deposit_hold_minutes })}</T>
                {venue.deposit_instructions ? (
                  <View style={{ backgroundColor: colors.surface2, borderRadius: 12, padding: 10 }}>
                    <T weight="semibold">{st("booking.howToPay")}</T>
                    <T selectable>{venue.deposit_instructions}</T>
                  </View>
                ) : null}
                <T muted style={{ fontSize: 13 }}>{st("booking.cancellationRuleDeposit", { hours: venue.cancellation_deadline_hours })}</T>
              </View>
            ) : (
              <View style={{ gap: 4 }}>
                <T muted>{venue.auto_confirm_bookings ? st("booking.autoConfirmNote") : st("booking.requestNote")}</T>
                <T muted style={{ fontSize: 13 }}>{st("booking.paymentNote")}</T>
                <T muted style={{ fontSize: 13 }}>{st("booking.cancellationRule", { hours: venue.cancellation_deadline_hours })}</T>
              </View>
            )}
            <Field label={st("booking.note")} value={note} onChangeText={setNote} maxLength={500} multiline />
            <Button
              label={deposit ? st("booking.holdAndPay") : venue.auto_confirm_bookings ? st("booking.bookNow") : st("booking.sendRequest")}
              onPress={book}
              busy={busy}
              disabled={atLimit}
              style={{ marginTop: 6 }}
            />
          </Card>
        ) : (
          <Notice tone="warning">
            {quote.conflict === "held"
              ? quote.held_until
                ? st("booking.conflict.held", { time: formatDateTime(quote.held_until) })
                : st("booking.conflict.heldReported")
              : quote.conflict === "gap"
                ? st("booking.conflict.gap", { minutes: quote.gap_minutes })
                : st(`booking.conflict.${quote.conflict ?? "booked"}`)}
          </Notice>
        )
      ) : time ? (
        <ActivityIndicator color={colors.accentText} />
      ) : null}
    </ScrollView>
  );
}
