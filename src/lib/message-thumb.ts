/**
 * A chat picture's small copy, stored next to it: `<conversation>/<name>.thumb.jpg`
 * beside `<conversation>/<name>.jpg`. The conversation shows the small copy
 * (it is never taller than 288 px there); tapping opens the picture itself.
 * Pictures sent before small copies existed have none, and show as they are.
 */
export function thumbPathOf(imagePath: string): string {
  return `${imagePath.replace(/\.[a-z0-9]+$/i, "")}.thumb.jpg`;
}

/** The small copy's longest side, in pixels: sharp enough at 288 px tall on most phones, a fraction of the bytes. */
export const THUMB_MAX_SIDE = 640;
