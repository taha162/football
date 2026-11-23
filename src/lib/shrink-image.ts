/**
 * Pictures straight from a phone are often several megabytes, and the site's
 * host refuses any request over 4.5 MB before the site even sees it (Vercel
 * answers 413 FUNCTION_PAYLOAD_TOO_LARGE). So pictures are made smaller in the
 * browser before they're sent: at most 1600 px on the long side, as JPEG, or
 * as PNG where transparency is kept. Small pictures go as they are. A file the
 * browser can't read goes as it is, and the server decides.
 */
const MAX_SIDE = 1600;
/** Smaller than this, and within MAX_SIDE, a picture is sent as it is. */
const SHRINK_ABOVE_BYTES = 1_500_000;
/** The most a form sends: under the host's 4.5 MB, with room for the other fields. */
export const UPLOAD_LIMIT_BYTES = 4 * 1024 * 1024;

const toBlob = (canvas: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));

/**
 * The picture as a page shows it. Read through an <img>, not createImageBitmap:
 * a photo taken upright on a phone is stored on its side with a tag saying how
 * to turn it, and Safari before 16.4 ignores that tag in createImageBitmap, so
 * the photo would be sent sideways. An <img> is turned the right way, and is
 * drawn on a canvas that way.
 */
const load = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("unreadable picture"));
    img.src = src;
  });

/**
 * The picture, made smaller where that helps. `keepTransparency`: PNG and WebP
 * stay PNG (a logo's transparent corners), unless that is still large (a photo
 * saved as PNG), then JPEG on white. Without it everything ends up JPEG (what
 * conversations send).
 */
export async function shrinkImage(file: File, { keepTransparency = false }: { keepTransparency?: boolean } = {}): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/svg+xml") return file;
  const fine = keepTransparency ? ["image/jpeg", "image/png", "image/webp"] : ["image/jpeg"];
  const url = URL.createObjectURL(file);
  try {
    const img = await load(url);
    const width = img.naturalWidth;
    const height = img.naturalHeight;
    if (!width || !height) return file;
    const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
    if (scale === 1 && file.size < SHRINK_ABOVE_BYTES && fine.includes(file.type)) return file;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    const transparent = keepTransparency && (file.type === "image/png" || file.type === "image/webp");
    const white = () => {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    };
    if (!transparent) white(); // JPEG has no transparency: white, not black, behind it
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    let blob = transparent ? await toBlob(canvas, "image/png") : null;
    if (!blob || blob.size > SHRINK_ABOVE_BYTES) {
      if (transparent) {
        ctx.globalCompositeOperation = "destination-over";
        white();
      }
      blob = await toBlob(canvas, "image/jpeg", 0.82);
    }
    if (!blob || (blob.size >= file.size && fine.includes(file.type))) return file;
    const type = blob.type === "image/png" ? "image/png" : "image/jpeg";
    const base = file.name.replace(/\.[^.]*$/, "") || "photo";
    return new File([blob], `${base}.${type === "image/png" ? "png" : "jpg"}`, { type });
  } catch {
    return file;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * A small JPEG copy of a picture, at most `maxSide` pixels on its long side
 * (a conversation shows it in place of the picture). Null when the browser
 * can't read the picture.
 */
export async function makeThumbnail(file: File, maxSide: number, quality = 0.72): Promise<File | null> {
  if (!file.type.startsWith("image/") || file.type === "image/svg+xml") return null;
  const url = URL.createObjectURL(file);
  try {
    const img = await load(url);
    const width = img.naturalWidth;
    const height = img.naturalHeight;
    if (!width || !height) return null;
    const scale = Math.min(1, maxSide / Math.max(width, height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await toBlob(canvas, "image/jpeg", quality);
    return blob && blob.type === "image/jpeg" ? new File([blob], "thumb.jpg", { type: "image/jpeg" }) : null;
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** The form's data with every picture made smaller where that helps; the same object when nothing changed. */
export async function shrinkFormImages(data: FormData, options?: { keepTransparency?: boolean }): Promise<FormData> {
  const entries = [...data.entries()];
  const shrunk = await Promise.all(
    entries.map(([, value]) => (value instanceof File && value.size > 0 && value.type.startsWith("image/") ? shrinkImage(value, options) : value)),
  );
  if (shrunk.every((value, i) => value === entries[i][1])) return data;
  const out = new FormData();
  entries.forEach(([key], i) => out.append(key, shrunk[i]));
  return out;
}

/** How many bytes of files the form's data carries. */
export function fileBytes(data: FormData): number {
  let bytes = 0;
  for (const value of data.values()) if (value instanceof File) bytes += value.size;
  return bytes;
}
