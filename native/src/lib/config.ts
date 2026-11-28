import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";

/** The site the app belongs to (app.config.ts). Its pages and its endpoints for the app (/api/app/…). */
export const SITE_URL: string = (Constants.expoConfig?.extra?.siteUrl as string | undefined) ?? "https://al-malab.vercel.app";
/** Built with Firebase (Android notifications)? Without it, asking for a token would fail. */
export const ANDROID_PUSH: boolean = Boolean(Constants.expoConfig?.extra?.androidPush);

export interface RemoteConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  siteUrl: string;
}

const KEY = "malaab.config";

/**
 * Where the database is, asked of the site when the app opens (/api/app/config),
 * and kept for the next opening without a connection.
 */
export async function loadConfig(): Promise<RemoteConfig | null> {
  try {
    const res = await fetch(`${SITE_URL}/api/app/config`, { headers: { Accept: "application/json" } });
    if (res.ok) {
      const config = (await res.json()) as RemoteConfig;
      if (config.supabaseUrl && config.supabaseAnonKey) {
        await AsyncStorage.setItem(KEY, JSON.stringify(config)).catch(() => undefined);
        return config;
      }
    }
  } catch {
    // Offline: the last one known.
  }
  const saved = await AsyncStorage.getItem(KEY).catch(() => null);
  return saved ? (JSON.parse(saved) as RemoteConfig) : null;
}
