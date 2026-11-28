import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { useAuth } from "../src/lib/auth";
import { errorText, fieldText } from "../src/lib/errors";
import { Button, Field, Notice, Screen, T } from "../src/ui/kit";
import { useColors } from "../src/ui/theme";

/**
 * Signing in: the WhatsApp number first, the e-mail the other way, as on the
 * site; a new account and a forgotten password are one tap away.
 */
export default function SignIn() {
  const colors = useColors();
  const { signIn } = useAuth();
  const router = useRouter();
  const [method, setMethod] = useState<"phone" | "email">("phone");
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<{ name: string; error: string } | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    setFieldError(null);
    const result = await signIn(method, login.trim(), password);
    setBusy(false);
    if (result.field) return setFieldError(result.field);
    if (result.error) return setError(result.error === "email_not_confirmed" ? "email_not_confirmed" : result.error);
    router.replace(result.secondStep ? "/second-step" : "/");
  };
  const fieldErr = (name: string) => (fieldError?.name === name ? fieldText(fieldError.error) : null);

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={{ padding: 24, gap: 18, flexGrow: 1, justifyContent: "center" }} keyboardShouldPersistTaps="handled">
            <View style={{ alignItems: "center", gap: 10, marginBottom: 8 }}>
              <Image source={require("../assets/icon.png")} style={{ width: 84, height: 84, borderRadius: 22 }} accessibilityIgnoresInvertColors />
              <T weight="bold" style={{ fontSize: 28 }}>الملعب</T>
              <T muted>سجّل الدخول لتتابع مبارياتك ومحادثاتك</T>
            </View>
            {error ? <Notice tone="danger">{errorText(error)}</Notice> : null}
            {method === "phone" ? (
              <Field
                label="رقم واتساب"
                placeholder="07XXXXXXXXX"
                keyboardType="phone-pad"
                autoComplete="tel"
                textContentType="telephoneNumber"
                value={login}
                onChangeText={setLogin}
                error={fieldErr("phone")}
              />
            ) : (
              <Field
                label="البريد الإلكتروني"
                placeholder="name@example.com"
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                textContentType="emailAddress"
                value={login}
                onChangeText={setLogin}
                error={fieldErr("email")}
              />
            )}
            <Field
              label="كلمة المرور"
              secureTextEntry
              autoComplete="password"
              textContentType="password"
              value={password}
              onChangeText={setPassword}
              onSubmitEditing={submit}
              error={fieldErr("password")}
            />
            <Button label="تسجيل الدخول" onPress={submit} busy={busy} disabled={!login || !password} />
            <Pressable onPress={() => setMethod(method === "phone" ? "email" : "phone")} accessibilityRole="button" style={{ alignSelf: "center", padding: 8 }}>
              <T weight="semibold" style={{ color: colors.accentText }}>{method === "phone" ? "الدخول بالبريد الإلكتروني بدلاً من ذلك" : "الدخول برقم واتساب بدلاً من ذلك"}</T>
            </Pressable>
            <View style={{ flexDirection: "row", justifyContent: "center", gap: 18, flexWrap: "wrap" }}>
              <Pressable onPress={() => router.push("/sign-up")} accessibilityRole="link" style={{ padding: 6 }}>
                <T muted>إنشاء حساب جديد</T>
              </Pressable>
              <Pressable onPress={() => router.push("/forgot")} accessibilityRole="link" style={{ padding: 6 }}>
                <T muted>نسيت كلمة المرور</T>
              </Pressable>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Screen>
  );
}
