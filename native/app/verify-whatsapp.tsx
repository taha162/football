import { useEffect, useRef, useState } from "react";
import { Linking, Pressable, ScrollView, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Clipboard from "expo-clipboard";
import { siteApi } from "../src/lib/api";
import { useAuth } from "../src/lib/auth";
import { Button, Card, Loading, Notice, T } from "../src/ui/kit";
import { useColors } from "../src/ui/theme";

const STATES: Record<string, string> = {
  expired: "انتهت صلاحية الرمز. ابدأ من جديد.",
  phone_taken: "هذا الرقم مرتبط بحساب آخر في «الملعب».",
  no_account: "لا يوجد حساب بهذا الرقم.",
  missing: "لم نجد هذا التحقق. ابدأ من جديد.",
};

/**
 * Waiting for the code from the number's WhatsApp (as the site's
 * /verify-whatsapp): the code, a button that opens WhatsApp with it typed in,
 * and a quiet check every two seconds (/api/app/whatsapp). Then onboarding
 * after a sign-up, or a new password after a reset.
 */
export default function VerifyWhatsapp() {
  const { ticket, code, link } = useLocalSearchParams<{ ticket: string; code: string; link: string; purpose: string }>();
  const router = useRouter();
  const colors = useColors();
  const { adoptSession } = useAuth();
  const [problem, setProblem] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const done = useRef(false);

  useEffect(() => {
    const timer = setInterval(async () => {
      if (done.current) return;
      const res = await siteApi<{ state?: string; next?: string; accessToken?: string; refreshToken?: string }>("/api/app/whatsapp", { ticket });
      if (res.state === "pending" || res.error) return;
      if (res.state === "done" && res.accessToken && res.refreshToken) {
        done.current = true;
        clearInterval(timer);
        if (await adoptSession({ accessToken: res.accessToken, refreshToken: res.refreshToken })) {
          router.replace(res.next === "new_password" ? "/new-password" : "/onboarding");
        }
        return;
      }
      done.current = true;
      clearInterval(timer);
      setProblem(STATES[res.state ?? "missing"] ?? STATES.missing);
    }, 2000);
    return () => clearInterval(timer);
  }, [ticket, adoptSession, router]);

  if (!ticket) return <Loading />;
  return (
    <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
      {problem ? (
        <>
          <Notice tone="danger">{problem}</Notice>
          <Button label="رجوع" variant="secondary" onPress={() => router.back()} />
        </>
      ) : (
        <>
          <T weight="bold" style={{ fontSize: 20 }}>أرسل هذا الرمز من واتساب رقمك</T>
          <T muted>اضغط الزر: يفتح واتساب والرمز مكتوب، فقط اضغط إرسال. نكمل وحدنا حين يصل.</T>
          <Card style={{ alignItems: "center", paddingVertical: 24 }}>
            <T muted style={{ fontSize: 13 }}>الرمز</T>
            <Pressable
              onPress={async () => {
                await Clipboard.setStringAsync(code ?? "");
                setCopied(true);
              }}
              accessibilityRole="button"
              accessibilityLabel={`الرمز ${code}، اضغط للنسخ`}
            >
              <T weight="bold" style={{ fontSize: 34, letterSpacing: 4, color: colors.accentText, writingDirection: "ltr" }}>{code}</T>
            </Pressable>
            <T muted style={{ fontSize: 12 }}>{copied ? "نُسخ الرمز" : "اضغط على الرمز لنسخه"}</T>
          </Card>
          <Button label="افتح واتساب وأرسل الرمز" onPress={() => void Linking.openURL(link ?? "")} />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, justifyContent: "center" }}>
            <Loading />
          </View>
          <T muted style={{ textAlign: "center" }}>ننتظر وصول الرمز…</T>
        </>
      )}
    </ScrollView>
  );
}
