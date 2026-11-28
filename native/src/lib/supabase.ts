import "react-native-url-polyfill/auto";
import { AppState, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { RemoteConfig } from "./config";
import { secureStorage } from "./secure-storage";

/**
 * The database, as the signed-in member: what they may see and do is decided
 * there (row-level security and its functions), exactly as on the site.
 */
let client: SupabaseClient | null = null;
let storageBase = "";

export function initSupabase(config: RemoteConfig): SupabaseClient {
  if (client) return client;
  storageBase = `${config.supabaseUrl}/storage/v1/object/public`;
  client = createClient(config.supabaseUrl, config.supabaseAnonKey, {
    // The phone's keychain; a browser (a preview of the screens only, never shipped) has none.
    auth: { storage: Platform.OS === "web" ? AsyncStorage : secureStorage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });
  // Keep the session fresh only while the app is on screen.
  AppState.addEventListener("change", (state) => {
    if (state === "active") client?.auth.startAutoRefresh();
    else client?.auth.stopAutoRefresh();
  });
  return client;
}

export function supabase(): SupabaseClient {
  if (!client) throw new Error("supabase_not_ready");
  return client;
}

/** Public pictures (members' pictures, group photos): the same addresses as on the site. */
export function publicUrl(bucket: string, path: string | null | undefined): string | null {
  return path ? `${storageBase}/${bucket}/${path}` : null;
}
