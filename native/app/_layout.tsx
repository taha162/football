import { useEffect, useState } from "react";
import { Platform, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import * as Notifications from "expo-notifications";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Cairo_400Regular, Cairo_600SemiBold, Cairo_700Bold, useFonts } from "@expo-google-fonts/cairo";
import { loadConfig } from "../src/lib/config";
import { initSupabase } from "../src/lib/supabase";
import { AuthProvider } from "../src/lib/auth";
import { screenFor } from "../src/lib/push";
import { Button, Empty, T } from "../src/ui/kit";
import { fonts, ThemeProvider, useColors } from "../src/ui/theme";

void SplashScreen.preventAutoHideAsync();
// The phones run right to left (app.config.ts: forcesRTL); a browser preview of the screens does too.
if (Platform.OS === "web" && typeof document !== "undefined") document.documentElement.dir = "rtl";

/** Opens the screen a tapped notification is about (also when it opened the app). */
function useNotificationTaps() {
  const router = useRouter();
  useEffect(() => {
    if (Platform.OS === "web") return;
    const open = (response: Notifications.NotificationResponse | null) => {
      const data = response?.notification.request.content.data as { href?: unknown } | undefined;
      const screen = screenFor(data?.href);
      if (screen) router.push(screen as never);
    };
    void Notifications.getLastNotificationResponseAsync().then(open);
    const sub = Notifications.addNotificationResponseReceivedListener(open);
    return () => sub.remove();
  }, [router]);
}

export default function RootLayout() {
  return (
    <ThemeProvider>
      <Root />
    </ThemeProvider>
  );
}

function Root() {
  const colors = useColors();
  const [fontsLoaded] = useFonts({ Cairo_400Regular, Cairo_600SemiBold, Cairo_700Bold });
  const [state, setState] = useState<"loading" | "ready" | "offline">("loading");

  const start = () => {
    setState("loading");
    void loadConfig().then((config) => {
      if (!config) return setState("offline");
      initSupabase(config);
      setState("ready");
    });
  };
  useEffect(start, []);
  useEffect(() => {
    if (fontsLoaded && state !== "loading") void SplashScreen.hideAsync();
  }, [fontsLoaded, state]);

  if (!fontsLoaded || state === "loading") return <View style={{ flex: 1, backgroundColor: colors.bg }} />;
  if (state === "offline") {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <Empty title="لا يوجد اتصال بالإنترنت">
          <T muted style={{ textAlign: "center" }}>تحقّق من الواي فاي أو بيانات الهاتف، ثم أعد المحاولة.</T>
          <Button label="إعادة المحاولة" onPress={start} />
        </Empty>
      </View>
    );
  }
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style={colors.scheme === "dark" ? "light" : "dark"} />
        <Routes />
      </AuthProvider>
    </SafeAreaProvider>
  );
}

function Routes() {
  const colors = useColors();
  useNotificationTaps();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.ink,
        headerTitleStyle: { fontFamily: fonts.bold },
        contentStyle: { backgroundColor: colors.bg },
        headerBackButtonDisplayMode: "minimal",
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="sign-in" options={{ headerShown: false }} />
      <Stack.Screen name="second-step" options={{ title: "رمز التحقق" }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="match/[id]" options={{ title: "المباراة" }} />
      <Stack.Screen name="venue/[id]" options={{ title: "الملعب" }} />
      <Stack.Screen name="chat/[id]" options={{ title: "" }} />
      <Stack.Screen name="delete-account" options={{ title: "حذف الحساب" }} />
      <Stack.Screen name="book/[venue]" options={{ title: "الحجز" }} />
      <Stack.Screen name="bookings" options={{ title: "حجوزاتي" }} />
    </Stack>
  );
}
