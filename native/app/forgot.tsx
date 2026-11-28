import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useRouter } from "expo-router";
import { siteApi } from "../src/lib/api";
import { errorText, fieldText } from "../src/lib/errors";
import { Button, Field, Notice, T } from "../src/ui/kit";
import { useColors } from "../src/ui/theme";

/** A forgotten password: by the account's WhatsApp number (a code sent from it) or its e-mail (a code e-mailed). */
export default function Forgot() {
  const router = useRouter();
  const colors = useColors();
  const [method, setMethod] = useState<"phone" | "email">("phone");
  const [login, setLogin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    const res = await siteApi<{ next?: string; ticket?: string; code?: string; link?: string }>("/api/app/forgot", { [method]: login.trim() });
    setBusy(false);
    if (res.field) return setError(fieldText(res.field.error));
    if (res.error) return setError(errorText(res.error));
    if (res.next === "whatsapp") router.push({ pathname: "/verify-whatsapp", params: { ticket: res.ticket!, code: res.code!, link: res.link!, purpose: "reset" } });
    else router.push({ pathname: "/verify-email", params: { email: login.trim(), purpose: "recovery" } });
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }} keyboardShouldPersistTaps="handled">
      <View style={{ flexDirection: "row", backgroundColor: colors.surface2, borderRadius: 16, padding: 5, gap: 6 }}>
        {(["phone", "email"] as const).map((m) => (
          <Pressable key={m} onPress={() => setMethod(m)} accessibilityRole="radio" accessibilityState={{ checked: method === m }} style={{ flex: 1, minHeight: 44, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: method === m ? colors.surface : "transparent" }}>
            <T weight={method === m ? "bold" : "semibold"}>{m === "phone" ? "رقم واتساب" : "البريد الإلكتروني"}</T>
          </Pressable>
        ))}
      </View>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {method === "phone" ? (
        <Field label="رقم واتساب الحساب" placeholder="07XXXXXXXXX" keyboardType="phone-pad" value={login} onChangeText={setLogin} hint="ترسل منه رمزاً لتختار كلمة مرور جديدة." />
      ) : (
        <Field label="بريد الحساب" keyboardType="email-address" autoCapitalize="none" value={login} onChangeText={setLogin} hint="نرسل إليه رمزاً، إن كان لحساب في «الملعب»." />
      )}
      <Button label="متابعة" onPress={submit} busy={busy} disabled={!login.trim()} />
    </ScrollView>
  );
}
