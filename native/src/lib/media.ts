import { Platform } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import { SITE_URL } from "./config";
import { supabase } from "./supabase";

export interface Picked {
  uri: string;
  /** A small copy for lists (the chat's thumbnails), when asked for. */
  thumb?: string;
}

/**
 * A picture from the phone (gallery or camera), made smaller on the phone
 * before it travels, as the site does in the browser: at most `max` pixels on
 * its longer side, JPEG. Null when the member cancels or refuses access.
 */
export async function pickPicture(source: "library" | "camera", opts: { max: number; thumb?: number; square?: boolean }): Promise<Picked | null> {
  const ask = source === "camera" ? ImagePicker.requestCameraPermissionsAsync : ImagePicker.requestMediaLibraryPermissionsAsync;
  if (Platform.OS !== "web" && !(await ask()).granted) return null;
  const launch = source === "camera" ? ImagePicker.launchCameraAsync : ImagePicker.launchImageLibraryAsync;
  const result = await launch({ mediaTypes: ["images"], quality: 1, allowsEditing: Boolean(opts.square), aspect: opts.square ? [1, 1] : undefined });
  const asset = result.canceled ? null : result.assets[0];
  if (!asset) return null;
  const longer = Math.max(asset.width || 0, asset.height || 0);
  const resize = (size: number) => (longer > size ? [{ resize: (asset.width ?? 0) >= (asset.height ?? 0) ? { width: size } : { height: size } }] : []);
  const main = await manipulateAsync(asset.uri, resize(opts.max), { compress: 0.82, format: SaveFormat.JPEG });
  const thumb = opts.thumb ? await manipulateAsync(asset.uri, resize(opts.thumb), { compress: 0.7, format: SaveFormat.JPEG }) : null;
  return { uri: main.uri, thumb: thumb?.uri };
}

/** A local file as a form part: the phone's own way, or a Blob in the browser preview. */
async function filePart(form: FormData, key: string, uri: string, name: string) {
  if (Platform.OS === "web") form.append(key, await (await fetch(uri)).blob(), name);
  else form.append(key, { uri, name, type: "image/jpeg" } as unknown as Blob);
}

/** Sends a form (with files) to the site's app endpoints, as the signed-in member. */
export async function siteUpload<T>(path: string, fields: Record<string, string>, files: Record<string, string | undefined>): Promise<T & { error?: string }> {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  for (const [k, uri] of Object.entries(files)) if (uri) await filePart(form, k, uri, `${k}.jpg`);
  const { data } = await supabase().auth.getSession();
  const headers: Record<string, string> = { Accept: "application/json" };
  if (data.session) headers.Authorization = `Bearer ${data.session.access_token}`;
  try {
    const res = await fetch(`${SITE_URL}${path}`, { method: "POST", headers, body: form });
    return (await res.json()) as T & { error?: string };
  } catch {
    return { error: "network" } as T & { error?: string };
  }
}
