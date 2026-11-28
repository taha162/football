import { Alert, Pressable, ScrollView, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";
import { useAuth } from "../../src/lib/auth";
import { publicUrl } from "../../src/lib/supabase";
import { Avatar, Button, Card, T } from "../../src/ui/kit";
import { useColors, useTheme, type ThemeMode } from "../../src/ui/theme";

/** The member: who they are, and the account's pages, all in the app. */
export default function Profile() {
  const colors = useColors();
  const { profile, signOut } = useAuth();
  const router = useRouter();
  const name = profile?.display_name ?? "";

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
      <Card style={{ alignItems: "center", gap: 10, paddingVertical: 24 }}>
        <Avatar uri={publicUrl("avatars", profile?.avatar_path)} name={name || "?"} size={88} />
        <T weight="bold" style={{ fontSize: 22 }}>{name}</T>
        {profile?.username ? <T style={{ color: colors.accentText }}>@{profile.username}</T> : null}
      </Card>

      <Card style={{ gap: 0, padding: 0 }}>
        <Item icon="person-outline" label="تعديل ملفي" onPress={() => router.push("/onboarding")} />
        <Item icon="people-outline" label="الأصدقاء" onPress={() => router.push("/friends")} />
        <Item icon="calendar-outline" label="حجوزاتي" onPress={() => router.push("/bookings")} />
        <Item icon="settings-outline" label="الإعدادات" onPress={() => router.push("/settings")} />
        <Item icon="shield-checkmark-outline" label="سياسة الخصوصية" onPress={() => router.push("/legal/privacy")} />
        <Item icon="document-text-outline" label="الشروط" onPress={() => router.push("/legal/terms")} last />
      </Card>

      <T weight="bold" style={{ fontSize: 16 }}>المظهر</T>
      <ThemePicker />

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
  const colors = useColors();
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

const MODES: { mode: ThemeMode; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { mode: "system", label: "تلقائي", icon: "phone-portrait-outline" },
  { mode: "light", label: "فاتح", icon: "sunny-outline" },
  { mode: "dark", label: "داكن", icon: "moon-outline" },
];

/** Light, dark, or as the phone is set (تلقائي, the default). Kept on this phone. */
function ThemePicker() {
  const { mode, setMode } = useTheme();
  const colors = useColors();
  return (
    <View accessibilityRole="radiogroup" style={{ flexDirection: "row", gap: 6, backgroundColor: colors.surface2, borderRadius: 16, padding: 5, borderWidth: 1, borderColor: colors.line }}>
      {MODES.map((m) => {
        const on = mode === m.mode;
        return (
          <Pressable
            key={m.mode}
            onPress={() => setMode(m.mode)}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            style={{ flex: 1, flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center", minHeight: 44, borderRadius: 12, backgroundColor: on ? colors.surface : "transparent", borderWidth: on ? 1 : 0, borderColor: colors.line }}
          >
            <Ionicons name={m.icon} size={17} color={on ? colors.accentText : colors.muted} />
            <T weight={on ? "bold" : "semibold"} style={{ color: on ? colors.ink : colors.muted }}>{m.label}</T>
          </Pressable>
        );
      })}
    </View>
  );
}
