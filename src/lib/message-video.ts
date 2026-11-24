/**
 * Videos in conversations (migration 0045): what may be sent, and where its
 * still lives. Shared by the composer (browser) and the server.
 *
 * A video goes from the browser straight to the private bucket
 * `message-videos` (the site's own server refuses requests over 4.5 MB), to a
 * name the server chose: `<conversation>/<random>.<mp4|mov|webm>`. Its still,
 * a small JPEG made in the browser, sits beside it: `<…>.poster.jpg`.
 */
export const MESSAGE_VIDEOS = "message-videos";

/** Largest video, in bytes (the bucket refuses more too). */
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;

/** The still's longest side, in pixels, and its largest size. */
export const POSTER_MAX_SIDE = 640;
export const MAX_POSTER_BYTES = 400 * 1024;

const EXTENSIONS = { "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm" } as const;
export type VideoType = keyof typeof EXTENSIONS;

export const isVideoType = (type: unknown): type is VideoType => typeof type === "string" && type in EXTENSIONS;

/** The file's video type: from its type, else from its name (some phones give no type). */
export function videoTypeOf(file: { type: string; name: string }): VideoType | null {
  const type = file.type.toLowerCase();
  if (isVideoType(type)) return type;
  if (type && !type.startsWith("video/") && type !== "application/octet-stream") return null;
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (ext === "mp4" || ext === "m4v") return "video/mp4";
  if (ext === "mov") return "video/quicktime";
  if (ext === "webm") return "video/webm";
  return null;
}

export const videoExtensionOf = (type: VideoType) => EXTENSIONS[type];

/** A stored video's name: in a conversation's folder, with a random name. */
export const VIDEO_PATH = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(mp4|mov|webm)$/;

/** The still beside a video: `<…>.poster.jpg`. */
export function posterPathOf(videoPath: string): string {
  return `${videoPath.replace(/\.[a-z0-9]+$/i, "")}.poster.jpg`;
}

/**
 * Whether a file's first bytes are a video's: MP4 and MOV start with a box
 * (`ftyp`, or `moov`, `mdat`, `wide`, `free` in older QuickTime files) after
 * its 4-byte length; WebM with the EBML mark. The name and the type a browser
 * gives are not trusted.
 */
export function isVideoSignature(b: Uint8Array): boolean {
  if (b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return true;
  if (b.length < 8) return false;
  const box = String.fromCharCode(b[4], b[5], b[6], b[7]);
  return ["ftyp", "moov", "mdat", "wide", "free"].includes(box);
}
