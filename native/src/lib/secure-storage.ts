import * as SecureStore from "expo-secure-store";

/**
 * Where Supabase keeps the session: the phone's keychain (iOS) or keystore
 * (Android), never plain storage. A session is larger than one keychain entry
 * comfortably holds, so it is split over several.
 */
const CHUNK = 1800;
const safe = (key: string) => key.replace(/[^A-Za-z0-9._-]/g, "_");

export const secureStorage = {
  async getItem(key: string): Promise<string | null> {
    const count = Number(await SecureStore.getItemAsync(`${safe(key)}.n`));
    if (!count) return null;
    const parts: string[] = [];
    for (let i = 0; i < count; i++) {
      const part = await SecureStore.getItemAsync(`${safe(key)}.${i}`);
      if (part === null) return null;
      parts.push(part);
    }
    return parts.join("");
  },
  async setItem(key: string, value: string): Promise<void> {
    await this.removeItem(key);
    const count = Math.ceil(value.length / CHUNK);
    for (let i = 0; i < count; i++) await SecureStore.setItemAsync(`${safe(key)}.${i}`, value.slice(i * CHUNK, (i + 1) * CHUNK));
    await SecureStore.setItemAsync(`${safe(key)}.n`, String(count));
  },
  async removeItem(key: string): Promise<void> {
    const count = Number(await SecureStore.getItemAsync(`${safe(key)}.n`));
    for (let i = 0; i < count; i++) await SecureStore.deleteItemAsync(`${safe(key)}.${i}`);
    await SecureStore.deleteItemAsync(`${safe(key)}.n`);
  },
};
