import { useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "../src/lib/auth";
import { Button, Field, Notice, Screen, T } from "../src/ui/kit";

/** With an authenticator app, the password is only the first step: its 6-digit code comes next. */
export default function SecondStep() {
  const { verifySecondStep, signOut } = useAuth();
  const router = useRouter();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [wrong, setWrong] = useState(false);

  const submit = async () => {
    setBusy(true);
    const error = await verifySecondStep(code);
    setBusy(false);
    if (error) return setWrong(true);
    router.replace("/(tabs)");
  };
  return (
    <Screen style={{ padding: 24, gap: 16 }}>
      <T muted>افتح تطبيق المصادقة واكتب الرمز المكوّن من 6 أرقام.</T>
      {wrong ? <Notice tone="danger">الرمز غير صحيح أو انتهت صلاحيته. جرّب الرمز الحالي.</Notice> : null}
      <Field label="الرمز" keyboardType="number-pad" autoComplete="one-time-code" textContentType="oneTimeCode" maxLength={8} value={code} onChangeText={setCode} onSubmitEditing={submit} />
      <Button label="تأكيد" onPress={submit} busy={busy} disabled={code.replace(/\D/g, "").length < 6} />
      <View style={{ height: 4 }} />
      <Button
        label="الخروج"
        variant="ghost"
        onPress={async () => {
          await signOut();
          router.replace("/sign-in");
        }}
      />
    </Screen>
  );
}
