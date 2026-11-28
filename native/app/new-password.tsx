import { useState } from "react";
import { ScrollView } from "react-native";
import { useRouter } from "expo-router";
import { siteApi } from "../src/lib/api";
import { errorText, fieldText } from "../src/lib/errors";
import { supabase } from "../src/lib/supabase";
import { Button, Field, Notice, T } from "../src/ui/kit";

/** After a reset: the new password (/api/app/password, recorded as on the site). */
export default function NewPassword() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    const { data } = await supabase().auth.getSession();
    const res = await siteApi<{ ok?: boolean }>("/api/app/password", { password, confirm, accessToken: data.session?.access_token, refreshToken: data.session?.refresh_token });
    setBusy(false);
    if (res.field) return setError(fieldText(res.field.error));
    if (!res.ok) return setError(errorText(res.error));
    router.replace("/(tabs)");
  };
  return (
    <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }} keyboardShouldPersistTaps="handled">
      <T muted>اختر كلمة مرور جديدة لحسابك.</T>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Field label="كلمة المرور الجديدة" secureTextEntry autoComplete="new-password" value={password} onChangeText={setPassword} hint="8 أحرف على الأقل." />
      <Field label="أعد كتابتها" secureTextEntry autoComplete="new-password" value={confirm} onChangeText={setConfirm} />
      <Button label="حفظ كلمة المرور" onPress={submit} busy={busy} disabled={!password || !confirm} />
    </ScrollView>
  );
}
