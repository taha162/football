import { Platform } from "react-native";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { ANDROID_PUSH } from "./config";
import { supabase } from "./supabase";

/**
 * Notifications on this phone (the site's migration 0051): the phone's own
 * token (FCM on Android, APNs on iPhone) is registered for the signed-in
 * member; the site sends to it. Asked once, after sign-in.
 */
const TOKEN_KEY = "malaab.pushToken";

Notifications.setNotificationHandler({
  // While the app is open, a notification still shows (the screen may be another one).
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

export async function registerForPush(): Promise<void> {
  if (Platform.OS === "web" || !Device.isDevice) return;
  // An Android build without Firebase can't get a token (its file is added by the build).
  if (Platform.OS === "android" && !ANDROID_PUSH) return;
  try {
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", { name: "الإشعارات", importance: Notifications.AndroidImportance.HIGH, lightColor: "#b8f23f" });
    }
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== "granted") ({ status } = await Notifications.requestPermissionsAsync());
    if (status !== "granted") return;
    const { data: token } = await Notifications.getDevicePushTokenAsync();
    if (typeof token !== "string") return;
    const { error } = await supabase().rpc("register_push_device", { p_token: token, p_platform: Platform.OS === "ios" ? "ios" : "android" });
    if (!error) await SecureStore.setItemAsync(TOKEN_KEY, token);
  } catch {
    // No notifications on this phone; everything else works.
  }
}

/** Signing out: this phone stops receiving the member's notifications. */
export async function unregisterPush(): Promise<void> {
  if (Platform.OS === "web") return;
  const token = await SecureStore.getItemAsync(TOKEN_KEY).catch(() => null);
  if (!token) return;
  await supabase().rpc("unregister_push_device", { p_token: token });
  await SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => undefined);
}

/** Where a tapped notification leads, in the app: its page on the site (href) mapped to a screen. */
export function screenFor(href: unknown): string | null {
  if (typeof href !== "string") return null;
  const chat = /^\/messages\/([0-9a-f-]{36})/.exec(href);
  if (chat) return `/chat/${chat[1]}`;
  const match = /^\/matches\/([0-9a-f-]{36})/.exec(href);
  if (match) return `/match/${match[1]}`;
  const venue = /^\/venues\/([0-9a-f-]{36})/.exec(href);
  if (venue) return `/venue/${venue[1]}`;
  if (href.startsWith("/messages")) return "/messages";
  return "/";
}
