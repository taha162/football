import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Switch, View } from "react-native";
import { useRouter } from "expo-router";
import { siteApi } from "../src/lib/api";
import { useAuth } from "../src/lib/auth";
import { errorText, fieldText } from "../src/lib/errors";
import { Button, Field, Notice, Screen, T } from "../src/ui/kit";
import { useColors } from "../src/ui/theme";

/**
 * A new account, as on the site: by WhatsApp number (the main way; then the
 * code is sent from that number's WhatsApp) or by e-mail (then the e-mailed
 * code). The site checks everything (/api/app/sign-up).
 */
export default function SignUp() {
  const router = useRouter();
  const colors = useColors();
  const { adoptSession } = useAuth();
  const [method, setMethod] = useState<"whatsapp" | "email">("whatsapp");
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [terms, setTerms] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [field, setField] = useState<{ name: string; error: string } | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    setField(null);
    const res = await siteApi<{ next?: string; email?: string; ticket?: string; code?: string; link?: string; accessToken?: string; refreshToken?: string }>("/api/app/sign-up", {
      method,
      display_name: name,
      username,
      [method === "whatsapp" ? "phone" : "email"]: login.trim(),
      password,
      accept_terms: terms,
    });
    setBusy(false);
    if (res.field) return setField(res.field);
    if (res.error) return setError(res.error);
    if (res.next === "whatsapp") return router.push({ pathname: "/verify-whatsapp", params: { ticket: res.ticket!, code: res.code!, link: res.link!, purpose: "signup" } });
    if (res.next === "email_code") return router.push({ pathname: "/verify-email", params: { email: res.email!, purpose: "signup" } });
    if (res.accessToken && res.refreshToken && (await adoptSession({ accessToken: res.accessToken, refreshToken: res.refreshToken }))) router.replace("/onboarding");
  };
  const err = (n: string) => (field?.name === n ? fieldText(field.error) : null);

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }} keyboardShouldPersistTaps="handled">
          <View style={{ flexDirection: "row", backgroundColor: colors.surface2, borderRadius: 16, padding: 5, gap: 6 }} accessibilityRole="radiogroup">
            {(["whatsapp", "email"] as const).map((m) => (
              <Pressable key={m} onPress={() => setMethod(m)} accessibilityRole="radio" accessibilityState={{ checked: method === m }} style={{ flex: 1, minHeight: 44, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: method === m ? colors.surface : "transparent" }}>
                <T weight={method === m ? "bold" : "semibold"}>{m === "whatsapp" ? "برقم واتساب" : "بالبريد الإلكتروني"}</T>
              </Pressable>
            ))}
          </View>
          {error ? <Notice tone="danger">{errorText(error)}</Notice> : null}
          <Field label="الاسم الظاهر" value={name} onChangeText={setName} autoComplete="name" maxLength={40} error={err("display_name")} />
          <Field label="اسم المستخدم" value={username} onChangeText={(v) => setUsername(v.replace(/^@/, "").toLowerCase())} autoCapitalize="none" autoCorrect={false} maxLength={20} hint="حروف إنجليزية وأرقام و _ ، يبحث به أصدقاؤك عنك." error={err("username")} />
          {method === "whatsapp" ? (
            <Field label="رقم واتساب" placeholder="07XXXXXXXXX" keyboardType="phone-pad" autoComplete="tel" value={login} onChangeText={setLogin} hint="ترسل منه رمزاً لتفعيل الحساب." error={err("phone")} />
          ) : (
            <Field label="البريد الإلكتروني" keyboardType="email-address" autoCapitalize="none" autoComplete="email" value={login} onChangeText={setLogin} error={err("email")} />
          )}
          <Field label="كلمة المرور" secureTextEntry autoComplete="new-password" value={password} onChangeText={setPassword} hint="8 أحرف على الأقل." error={err("password")} />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Switch value={terms} onValueChange={setTerms} accessibilityLabel="أوافق على الشروط وسياسة الخصوصية" trackColor={{ true: colors.accentText, false: colors.lineStrong }} />
            <Pressable onPress={() => router.push("/legal/terms")} style={{ flex: 1 }}>
              <T>أوافق على <T style={{ color: colors.accentText }}>الشروط وسياسة الخصوصية</T></T>
            </Pressable>
          </View>
          {err("accept_terms") ? <T style={{ color: colors.danger }}>{err("accept_terms")}</T> : null}
          {method === "whatsapp" ? <T muted style={{ fontSize: 13 }}>بالتسجيل بواتساب تصلك عروض «الملعب» على واتساب، ويمكنك إيقافها من الإعدادات.</T> : null}
          <Button label="إنشاء الحساب" onPress={submit} busy={busy} disabled={!name || !username || !login || !password} />
          <Pressable onPress={() => router.replace("/sign-in")} style={{ alignSelf: "center", padding: 8 }}>
            <T muted>لديك حساب؟ <T style={{ color: colors.accentText }}>تسجيل الدخول</T></T>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
