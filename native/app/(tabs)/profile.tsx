import { Alert, Pressable, ScrollView } from "react-native";
import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";
import { useAuth } from "../../src/lib/auth";
import { SITE_URL } from "../../src/lib/config";
import { publicUrl } from "../../src/lib/supabase";
import { Avatar, Button, Card, T } from "../../src/ui/kit";
import { colors } from "../../src/ui/theme";

/** The member: who they are, and the account's pages (settings that live on the site open in it for now). */
export default function Profile() {
  const { profile, signOut } = useAuth();
  const router = useRouter();
  const open = (path: string) => void WebBrowser.openBrowserAsync(`${SITE_URL}/ar${path}`);
  const name = profile?.display_name ?? "";

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
      <Card style={{ alignItems: "center", gap: 10, paddingVertical: 24 }}>
        <Avatar uri={publicUrl("avatars", profile?.avatar_path)} name={name || "?"} size={88} />
        <T weight="bold" style={{ fontSize: 22 }}>{name}</T>
        {profile?.username ? <T style={{ color: colors.accent }}>@{profile.username}</T> : null}
      </Card>

      <Card style={{ gap: 0, padding: 0 }}>
        <Item icon="person-outline" label="ملفي الشخصي" onPress={() => open("/profile")} />
        <Item icon="people-outline" label="الأصدقاء" onPress={() => open("/friends")} />
        <Item icon="calendar-outline" label="حجوزاتي" onPress={() => open("/my/bookings")} />
        <Item icon="settings-outline" label="الإعدادات" onPress={() => open("/settings")} />
        <Item icon="shield-checkmark-outline" label="سياسة الخصوصية" onPress={() => open("/legal/privacy")} last />
      </Card>
      <T muted style={{ fontSize: 13 }}>هذه الصفحات تُفتح من الموقع داخل التطبيق، إلى أن تصل إلى التطبيق نفسه.</T>

      <Button
        label="تسجيل الخروج"
        variant="secondary"
        onPress={() =>
          Alert.alert("تسجيل الخروج؟", "تتوقف إشعارات هذا الهاتف حتى تدخل من جديد.", [
            { text: "إلغاء", style: "cancel" },
            {
              text: "خروج",
              style: "destructive",
              onPress: async () => {
                await signOut();
                router.replace("/sign-in");
              },
            },
          ])
        }
      />
      <Button label="حذف الحساب" variant="danger" onPress={() => router.push("/delete-account")} />
      <T style={{ textAlign: "center", fontSize: 12, color: colors.faint }}>الإصدار {Constants.expoConfig?.version ?? ""}</T>
    </ScrollView>
  );
}

function Item({ icon, label, onPress, last }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; last?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="link"
      style={({ pressed }) => [
        { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 54, paddingHorizontal: 16 },
        !last && { borderBottomColor: colors.line, borderBottomWidth: 1 },
        pressed && { backgroundColor: colors.surface2 },
      ]}
    >
      <Ionicons name={icon} size={20} color={colors.muted} />
      <T weight="semibold" style={{ flex: 1 }}>{label}</T>
      {/* Pointing forward: the way pages open in a right-to-left layout. */}
      <Ionicons name="chevron-back" size={18} color={colors.faint} />
    </Pressable>
  );
}
