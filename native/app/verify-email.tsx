import { useState } from "react";
import { ScrollView } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { siteApi } from "../src/lib/api";
import { useAuth } from "../src/lib/auth";
import { errorText, fieldText } from "../src/lib/errors";
import { Button, Field, Notice, T } from "../src/ui/kit";

/** The code e-mailed for a new account or a password reset (/api/app/email-code), with resending for a new account. */
export default function VerifyEmail() {
  const { email, purpose } = useLocalSearchParams<{ email: string; purpose: "signup" | "recovery" }>();
  const router = useRouter();
  const { adoptSession } = useAuth();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "danger" | "success"; text: string } | null>(null);

  const submit = async () => {
    setBusy(true);
    setMessage(null);
    const res = await siteApi<{ next?: string; accessToken?: string; refreshToken?: string }>("/api/app/email-code", { email, code, purpose });
    setBusy(false);
    if (res.field) return setMessage({ tone: "danger", text: fieldText(res.field.error) });
    if (res.error || !res.accessToken || !res.refreshToken) return setMessage({ tone: "danger", text: errorText(res.error) });
    if (await adoptSession({ accessToken: res.accessToken, refreshToken: res.refreshToken })) router.replace(res.next === "new_password" ? "/new-password" : "/onboarding");
  };
  const resend = async () => {
    const res = await siteApi<{ ok?: boolean }>("/api/app/email-code", { email, resend: true });
    setMessage(res.ok ? { tone: "success", text: "أرسلنا رمزاً جديداً." } : { tone: "danger", text: errorText(res.error) });
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }} keyboardShouldPersistTaps="handled">
      <T weight="bold" style={{ fontSize: 20 }}>{purpose === "recovery" ? "رمز استعادة كلمة المرور" : "تأكيد بريدك"}</T>
      <T muted>أرسلنا رمزاً إلى {email}. اكتبه هنا. إن لم تجده، تفقّد مجلد الرسائل غير المرغوب فيها.</T>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      <Field label="الرمز" keyboardType="number-pad" autoComplete="one-time-code" textContentType="oneTimeCode" maxLength={10} value={code} onChangeText={setCode} onSubmitEditing={submit} />
      <Button label="تأكيد" onPress={submit} busy={busy} disabled={code.replace(/\D/g, "").length < 6} />
      {purpose !== "recovery" ? <Button label="أرسل رمزاً جديداً" variant="ghost" onPress={resend} /> : null}
    </ScrollView>
  );
}
