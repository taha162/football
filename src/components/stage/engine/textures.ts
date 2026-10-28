import { CanvasTexture, LinearFilter, RepeatWrapping, SRGBColorSpace } from "three";

/** Soft radial glow for lamp heads (white core, falling off to nothing). */
export function glowTexture(size = 256): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  const r = size / 2;
  const grad = g.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.08, "rgba(255,255,250,0.85)");
  grad.addColorStop(0.22, "rgba(235,250,215,0.32)");
  grad.addColorStop(0.5, "rgba(200,240,160,0.08)");
  grad.addColorStop(1, "rgba(184,242,63,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** Horizontal anamorphic streak: the long flare a cinema lens draws through a bright light. */
export function streakTexture(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 32;
  const g = c.getContext("2d")!;
  const img = g.createImageData(c.width, c.height);
  for (let y = 0; y < c.height; y++) {
    const vy = (y - c.height / 2 + 0.5) / (c.height / 2);
    for (let x = 0; x < c.width; x++) {
      const vx = (x - c.width / 2 + 0.5) / (c.width / 2);
      const a = Math.exp(-vy * vy * 14) * Math.pow(Math.max(0, 1 - Math.abs(vx)), 2.2);
      const i = (y * c.width + x) * 4;
      img.data[i] = 220;
      img.data[i + 1] = 236;
      img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(a * 255);
    }
  }
  g.putImageData(img, 0, 0);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

export interface BoardItem {
  text: string;
  /** "display" for the wordmark, "body" for secondary words, "dot" for separators. */
  kind: "display" | "body" | "dot";
}

/**
 * LED advertising board content, lime on black, repeated along the board.
 * Drawn with the page's own fonts so Arabic is shaped by the browser.
 */
export function boardTexture(items: BoardItem[], fonts: { arabic: string; latin: string }): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 2048;
  c.height = 96;
  const g = c.getContext("2d")!;
  g.fillStyle = "#040604";
  g.fillRect(0, 0, c.width, c.height);
  // LED pixel grid, barely visible.
  g.fillStyle = "rgba(184,242,63,0.035)";
  for (let x = 0; x < c.width; x += 4) g.fillRect(x, 0, 1, c.height);
  g.textBaseline = "middle";
  const styleOf = (it: BoardItem) => {
    const arabic = /[؀-ۿ]/.test(it.text);
    const family = arabic ? fonts.arabic : fonts.latin;
    if (it.kind === "dot") return { font: `700 58px ${fonts.latin}`, color: "rgba(233,241,235,0.55)" };
    if (it.kind === "display") return { font: `800 ${arabic ? 54 : 58}px ${family}`, color: "#b8f23f" };
    return { font: `600 ${arabic ? 44 : 46}px ${family}`, color: "rgba(233,241,235,0.9)" };
  };
  // Lay the sequence out once to know its width, then repeat it seamlessly.
  const widths = items.map((it) => {
    g.font = styleOf(it).font;
    return g.measureText(it.text).width + 44;
  });
  const period = widths.reduce((a, b) => a + b, 0);
  const repeats = Math.max(1, Math.round(c.width / period));
  const scale = c.width / (period * repeats);
  g.save();
  g.scale(scale, 1);
  let x = 22;
  for (let r = 0; r < repeats; r++) {
    items.forEach((it, i) => {
      const s = styleOf(it);
      g.font = s.font;
      g.fillStyle = s.color;
      const rtl = /[؀-ۿ]/.test(it.text);
      g.direction = rtl ? "rtl" : "ltr";
      g.textAlign = rtl ? "right" : "left";
      g.fillText(it.text, rtl ? x + widths[i] - 44 : x, c.height / 2 + 2);
      x += widths[i];
    });
  }
  g.restore();
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = RepeatWrapping;
  t.minFilter = LinearFilter;
  t.anisotropy = 4;
  return t;
}

/** Text label for a tactical marker, drawn flat on the pitch like a broadcast graphic. */
export function labelTexture(lines: { text: string; font: string; color: string }[], rtl: boolean): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 1024;
  c.height = 256;
  const g = c.getContext("2d")!;
  g.direction = rtl ? "rtl" : "ltr";
  g.textAlign = "center";
  g.textBaseline = "middle";
  const step = c.height / (lines.length + 1);
  lines.forEach((l, i) => {
    g.font = l.font;
    g.fillStyle = l.color;
    g.fillText(l.text, c.width / 2, step * (i + 1));
  });
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
