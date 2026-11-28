import type { ColorValue } from "react-native";
import { Redirect, Tabs } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../../src/lib/auth";
import { colors, fonts } from "../../src/ui/theme";

type Icon = keyof typeof Ionicons.glyphMap;
const tab = (title: string, icon: Icon) => ({
  title,
  tabBarIcon: ({ color, size }: { color: ColorValue; size: number }) => <Ionicons name={icon} color={color as string} size={size} />,
});

/** The bottom bar, as on the site's phone layout. Signed-in members only. */
export default function TabsLayout() {
  const { session, needsSecondStep } = useAuth();
  const insets = useSafeAreaInsets();
  if (!session) return <Redirect href="/sign-in" />;
  if (needsSecondStep) return <Redirect href="/second-step" />;
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.ink,
        headerTitleStyle: { fontFamily: fonts.bold },
        // Cairo's letters are tall: the bar leaves them room (and keeps clear of the home bar).
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.line, height: 68 + insets.bottom, paddingTop: 6, paddingBottom: insets.bottom + 6 },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: { fontFamily: fonts.semibold, fontSize: 11, lineHeight: 21 },
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen name="index" options={tab("الرئيسية", "home-outline")} />
      <Tabs.Screen name="matches" options={tab("المباريات", "football-outline")} />
      <Tabs.Screen name="venues" options={tab("الملاعب", "location-outline")} />
      <Tabs.Screen name="messages" options={tab("الرسائل", "chatbubbles-outline")} />
      <Tabs.Screen name="profile" options={tab("حسابي", "person-circle-outline")} />
    </Tabs>
  );
}
