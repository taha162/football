/** The site's palette (src/app/globals.css) and type: Cairo, as on the Arabic pages. */
export const colors = {
  bg: "#0a0e0b",
  surface: "#111712",
  surface2: "#172019",
  surface3: "#1e2a21",
  line: "#263329",
  lineStrong: "#34453a",
  ink: "#e9f1eb",
  muted: "#9daea3",
  faint: "#6f8276",
  accent: "#b8f23f",
  accentInk: "#0a0e0b",
  danger: "#ff6b6b",
  warning: "#ffb547",
  success: "#4ade80",
} as const;

export const fonts = {
  regular: "Cairo_400Regular",
  semibold: "Cairo_600SemiBold",
  bold: "Cairo_700Bold",
} as const;

export const radius = { card: 16, pill: 999 } as const;
