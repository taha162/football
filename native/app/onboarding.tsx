import { useEffect, useState } from "react";
import { ScrollView } from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "../src/lib/auth";
import { dbCode, errorText } from "../src/lib/errors";
import { supabase } from "../src/lib/supabase";
import { st } from "../src/lib/texts";
import { Choice } from "../src/ui/choice";
import { Button, Field, Loading, Notice, T } from "../src/ui/kit";

const POSITIONS = ["goalkeeper", "defender", "midfielder", "forward"] as const;
const SKILLS = ["beginner", "intermediate", "advanced"] as const;
const FORMATS = ["5v5", "6v6", "7v7", "8v8", "9v9", "11v11"] as const;

/**
 * The first visit after signing up (as the site's /onboarding): the name, the
 * city, and how the member plays. Saved with update_my_profile, which marks
 * the profile complete; the same screen edits the profile later.
 */
export default function Onboarding() {
  const { profile, refreshProfile } = useAuth();
  const router = useRouter();
  const editing = Boolean(profile?.onboarded_at);
  const [cities, setCities] = useState<{ id: string; name_ar: string }[] | null>(null);
  const [name, setName] = useState(profile?.display_name ?? "");
  const [city, setCity] = useState<string | null>(null);
  const [bio, setBio] = useState("");
  const [positions, setPositions] = useState<string[]>([]);
  const [skill, setSkill] = useState<string | null>(null);
  const [formats, setFormats] = useState<string[]>(["5v5"]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const db = supabase();
      const [{ data: list }, { data: me }] = await Promise.all([
        db.from("cities").select("id, name_ar").eq("is_active", true).order("sort_order"),
        profile ? db.from("profiles").select("display_name, city_id, bio, positions, skill_level, preferred_formats").eq("id", profile.id).maybeSingle() : Promise.resolve({ data: null }),
      ]);
      setCities((list ?? []) as { id: string; name_ar: string }[]);
      const p = me as { display_name: string; city_id: string | null; bio: string | null; positions: string[]; skill_level: string | null; preferred_formats: string[] } | null;
      if (p) {
        setName(p.display_name);
        setCity(p.city_id);
        setBio(p.bio ?? "");
        setPositions(p.positions ?? []);
        setSkill(p.skill_level);
        if (p.preferred_formats?.length) setFormats(p.preferred_formats);
      }
    })();
  }, [profile]);

  const save = async () => {
    if (!city) return setError("اختر مدينتك.");
    setBusy(true);
    setError(null);
    const { error: e } = await supabase().rpc("update_my_profile", {
      p_display_name: name.trim(),
      p_city_id: city,
      p_bio: bio.trim() || null,
      p_positions: positions,
      p_skill_level: skill,
      p_preferred_formats: formats,
      p_show_match_history: true,
      p_complete_onboarding: !editing,
    });
    setBusy(false);
    if (e) return setError(errorText(dbCode(e)));
    await refreshProfile();
    if (editing) router.back();
    else router.replace("/(tabs)");
  };

  if (!cities) return <Loading />;
  return (
    <ScrollView contentContainerStyle={{ padding: 20, gap: 18 }} keyboardShouldPersistTaps="handled">
      {!editing ? <T weight="bold" style={{ fontSize: 22 }}>أهلاً بك في «الملعب»! أخبرنا كيف تلعب.</T> : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Field label="الاسم الظاهر" value={name} onChangeText={setName} maxLength={40} />
      <T weight="bold">المدينة</T>
      <Choice options={cities.map((c) => ({ value: c.id, label: c.name_ar }))} value={city} onChange={(v) => setCity(v as string)} />
      <T weight="bold">مراكزك</T>
      <Choice multiple options={POSITIONS.map((p) => ({ value: p, label: st(`enums.position.${p}`) }))} value={positions} onChange={(v) => setPositions(v as string[])} />
      <T weight="bold">مستواك</T>
      <Choice options={SKILLS.map((s) => ({ value: s, label: st(`enums.skill.${s}`) }))} value={skill} onChange={(v) => setSkill(v as string)} />
      <T weight="bold">ما تحب أن تلعبه</T>
      <Choice multiple options={FORMATS.map((f) => ({ value: f, label: f.replace("v", " × ") }))} value={formats} onChange={(v) => setFormats(v as string[])} />
      <Field label="نبذة (اختياري)" value={bio} onChangeText={setBio} maxLength={500} multiline />
      <Button label={editing ? "حفظ" : "ابدأ"} onPress={save} busy={busy} disabled={name.trim().length < 2} />
    </ScrollView>
  );
}
