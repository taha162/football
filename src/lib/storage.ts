import { publicEnv } from "@/lib/env";

export type Bucket = "avatars" | "team-logos" | "venue-images";

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export function publicStorageUrl(bucket: Bucket, path: string | null | undefined): string | null {
  if (!path || !publicEnv.supabaseUrl) return null;
  return `${publicEnv.supabaseUrl}/storage/v1/object/public/${bucket}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

const SIGNATURES: { mime: string; ext: string; test: (b: Uint8Array) => boolean }[] = [
  { mime: "image/jpeg", ext: "jpg", test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: "image/png", ext: "png", test: (b) => [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => b[i] === v) },
  {
    mime: "image/webp",
    ext: "webp",
    test: (b) => String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP",
  },
];

/**
 * Validates an uploaded image by size and magic bytes (the declared MIME type
 * and file name are not trusted). Returns the detected type or an error code.
 */
export async function inspectImage(file: File): Promise<{ ok: true; mime: string; ext: string; bytes: Uint8Array } | { ok: false; error: string }> {
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "file_missing" };
  if (file.size > MAX_IMAGE_BYTES) return { ok: false, error: "file_too_large" };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const match = SIGNATURES.find((s) => s.test(bytes));
  if (!match) return { ok: false, error: "file_type_not_allowed" };
  return { ok: true, mime: match.mime, ext: match.ext, bytes };
}

export function randomFileName(ext: string): string {
  return `${crypto.randomUUID()}.${ext}`;
}
