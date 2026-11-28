import { useEffect, useMemo, useState } from "react";
import { ScrollView, Switch, View } from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "../src/lib/auth";
import { dbCode, errorText } from "../src/lib/errors";
import { clock, comingDays } from "../src/lib/format";
import { supabase } from "../src/lib/supabase";
import { st } from "../src/lib/texts";
import { Choice } from "../src/ui/choice";
import { Button, Field, Loading, Notice, T } from "../src/ui/kit";
import { useColors } from "../src/ui/theme";

const FORMATS = ["5v5", "6v6", "7v7", "8v8", "9v9", "11v11"] as const;
const SKILLS = ["beginner", "intermediate", "advanced"] as const;
const DURATIONS = [60, 90, 120] as const;
// Evening hours first: when most matches are played.
const TIMES = ["16:00", "17:00", "18:00", "19:00", "20:00", "21:00", "22:00", "23:00", "08:00", "10:00", "12:00", "14:00"];
const playersOf = (format: string) => Number(format.split("v")[0]) * 2;

/**
 * Organising a match from the phone: the essentials of the site's form
 * (/matches/new), saved with the same create_match, which checks everything
 * again (the city, the time not too soon, the capacity). The finer options
 * (a listed venue's field, costs split, recurring weeks) stay on the match's
 * page afterwards.
 */
export default function NewMatch() {
  const colors = useColors();
  const router = useRouter();
  const { profile } = useAuth();
  const days = useMemo(() => comingDays(14), []);
  const [cities, setCities] = useState<{ id: string; name_ar: string }[] | null>(null);
  const [title, setTitle] = useState("");
  const [city, setCity] = useState<string | null>(null);
  const [format, setFormat] = useState<string>("5v5");
  const [day, setDay] = useState(days[1].date);
  const [time, setTime] = useState("20:00");
  const [duration, setDuration] = useState(60);
  const [players, setPlayers] = useState("10");
  const [price, setPrice] = useState("");
  const [skill, setSkill] = useState<string | null>(null);
  const [place, setPlace] = useState("");
  const [approval, setApproval] = useState(false);
  const [plays, setPlays] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const db = supabase();
      const [{ data: list }, { data: me }] = await Promise.all([
        db.from("cities").select("id, name_ar").eq("is_active", true).order("sort_order"),
        profile ? db.from("profiles").select("city_id").eq("id", profile.id).maybeSingle() : Promise.resolve({ data: null }),
      ]);
      setCities((list ?? []) as { id: string; name_ar: string }[]);
      setCity((me as { city_id: string | null } | null)?.city_id ?? null);
    })();
  }, [profile]);

  const create = async () => {
    if (!city) return setError("اختر المدينة.");
    const total = Number(players);
    if (!Number.isInteger(total) || total < 2 || total > 30) return setError("عدد اللاعبين من 2 إلى 30.");
    const perPlayer = price.trim() ? Number(price.replace(/[^\d]/g, "")) : null;
    setBusy(true);
    setError(null);
    const { data, error: e } = await supabase().rpc("create_match", {
      p_title: title.trim(),
      p_city_id: city,
      p_format: format,
      p_start_local: `${day} ${time}`,
      p_duration_minutes: duration,
      p_total_players: total,
      p_price_per_player: perPlayer ?? undefined,
      p_skill_level: skill ?? undefined,
      p_location_note: place.trim() || undefined,
      p_join_policy: approval ? "approval" : "open",
      p_organizer_plays: plays,
      p_leave_deadline_hours: 6,
    });
    setBusy(false);
    if (e) return setError(errorText(dbCode(e)));
    router.replace(`/match/${data as string}`);
  };

  if (!cities) return <Loading />;
  return (
    <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }} keyboardShouldPersistTaps="handled">
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Field label="اسم المباراة" value={title} onChangeText={setTitle} maxLength={100} placeholder="مثلاً: مباراة الخميس" />
      <T weight="bold">المدينة</T>
      <Choice options={cities.map((c) => ({ value: c.id, label: c.name_ar }))} value={city} onChange={(v) => setCity(v as string)} />
      <T weight="bold">النظام</T>
      <Choice
        options={FORMATS.map((f) => ({ value: f, label: f.replace("v", " × ") }))}
        value={format}
        onChange={(v) => {
          setFormat(v as string);
          setPlayers(String(playersOf(v as string)));
        }}
      />
      <T weight="bold">اليوم</T>
      <Choice options={days.map((d) => ({ value: d.date, label: `${d.weekday} ${d.day} ${d.month}` }))} value={day} onChange={(v) => setDay(v as string)} />
      <T weight="bold">الساعة (بتوقيت بغداد)</T>
      <Choice options={TIMES.map((t) => ({ value: t, label: clock(t) }))} value={time} onChange={(v) => setTime(v as string)} />
      <T weight="bold">المدة</T>
      <Choice options={DURATIONS.map((d) => ({ value: String(d), label: `${d} دقيقة` }))} value={String(duration)} onChange={(v) => setDuration(Number(v))} />
      <Field label="عدد اللاعبين" value={players} onChangeText={setPlayers} keyboardType="number-pad" maxLength={2} />
      <Field label="السعر على اللاعب (د.ع، اختياري)" value={price} onChangeText={setPrice} keyboardType="number-pad" maxLength={9} placeholder="مجانية إن تركته فارغاً" />
      <T weight="bold">المستوى (اختياري)</T>
      <Choice options={SKILLS.map((s) => ({ value: s, label: st(`enums.skill.${s}`) }))} value={skill} onChange={(v) => setSkill(skill === v ? null : (v as string))} />
      <Field label="المكان" value={place} onChangeText={setPlace} maxLength={300} placeholder="اسم الملعب أو العنوان" />
      <Toggle label="أوافق على كل لاعب قبل انضمامه" value={approval} onChange={setApproval} colors={colors} />
      <Toggle label="سألعب في هذه المباراة" value={plays} onChange={setPlays} colors={colors} />
      <Button label="إنشاء المباراة" onPress={create} busy={busy} disabled={title.trim().length < 3 || !city} />
    </ScrollView>
  );
}

function Toggle({ label, value, onChange, colors }: { label: string; value: boolean; onChange: (v: boolean) => void; colors: ReturnType<typeof useColors> }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, minHeight: 48 }}>
      <T weight="semibold" style={{ flex: 1 }}>{label}</T>
      <Switch value={value} onValueChange={onChange} accessibilityLabel={label} trackColor={{ true: colors.accent, false: colors.line }} />
    </View>
  );
}
