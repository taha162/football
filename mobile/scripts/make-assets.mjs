// Draws the app's source pictures from the site's own logo (public/brand), for
// `npm run assets` (@capacitor/assets), which makes every icon and splash size
// for Android and iOS from them:
// - icon-only.png: the full icon (iOS, older Android), edge to edge: stores round the corners.
// - icon-foreground.png / icon-background.png: Android's adaptive icon (the mark inside the safe zone).
// - splash.png / splash-dark.png: the logo on the site's dark background.
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { fileURLToPath } from "node:url";

const brand = (name) => fileURLToPath(new URL(`../../public/brand/${name}`, import.meta.url));
const out = (name) => fileURLToPath(new URL(`../assets/${name}`, import.meta.url));
const LIME = "#baff1b";
const DARK = "#0a0e0b";

// The mark without its rounded frame and its outline, for icons the stores shape themselves.
const plainMark = () => {
  const svg = readFileSync(brand("al-malab-mark.svg"), "utf8")
    .replace(/<rect width="350\.125" height="346\.066" rx="[0-9.]+" fill="#baff1b"\/>/, '<rect width="350.125" height="346.066" fill="#baff1b"/>')
    .replace(/<rect x="5\.247"[^>]*stroke="#c4ef61"[^>]*\/>/, "");
  return Buffer.from(svg);
};
const mark = (size, source = plainMark()) => sharp(source, { density: 600 }).resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
const canvas = (size, background) => sharp({ create: { width: size, height: size, channels: 4, background } });

await canvas(1024, LIME).composite([{ input: await mark(1024) }]).png().toFile(out("icon-only.png"));
// Android's adaptive icon: the launcher crops it to a circle or a squircle and moves the
// foreground a little over the background. The background carries the lime and the dark band
// across the whole width; the foreground the disc and the player (no lime square), at 72% so the
// disc keeps a lime ring inside every shape.
const SCALE = 0.72;
const side = Math.round(1024 * SCALE);
const bandHeight = Math.round((53.973 / 346.066) * side);
const bandTop = Math.round(512 + ((148.752 - 173.0312) / 346.066) * side);
const discOnly = Buffer.from(plainMark().toString().replace('<rect width="350.125" height="346.066" fill="#baff1b"/>', ""));
await canvas(1024, { r: 0, g: 0, b: 0, alpha: 0 })
  .composite([{ input: await sharp(discOnly, { density: 600 }).resize(side, side, { fit: "fill" }).png().toBuffer(), gravity: "center" }])
  .png().toFile(out("icon-foreground.png"));
await canvas(1024, LIME)
  .composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect y="${bandTop}" width="1024" height="${bandHeight}" fill="#0c0e0b"/></svg>`) }])
  .png().toFile(out("icon-background.png"));
// The splash: the site's mark as it appears in its header, rounded frame and all, on the dark background.
const splash = await canvas(2732, DARK).composite([{ input: await mark(640, readFileSync(brand("al-malab-mark.svg"))), gravity: "center" }]).png().toBuffer();
await sharp(splash).toFile(out("splash.png"));
await sharp(splash).toFile(out("splash-dark.png"));
console.log("assets/: icon-only, icon-foreground, icon-background, splash, splash-dark");
