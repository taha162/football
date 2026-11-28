import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useColorScheme } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Two palettes from the site's brand (the lime of the logo, the pitch's
 * green): light by default, dark on request, or whichever the phone uses
 * (تلقائي, the default). The member's choice is kept on the phone.
 */
export interface Palette {
  scheme: "light" | "dark";
  bg: string;
  surface: string;
  surface2: string;
  surface3: string;
  line: string;
  lineStrong: string;
  ink: string;
  muted: string;
  faint: string;
  /** The lime: fills (buttons, badges), with accentInk on it. */
  accent: string;
  accentInk: string;
  /** Lime as text or an icon on the page: readable on both backgrounds. */
  accentText: string;
  pitch: string;
  pitchDeep: string;
  danger: string;
  warning: string;
  success: string;
  info: string;
  /** My message's bubble. */
  mine: string;
  shadow: string;
}

const light: Palette = {
  scheme: "light",
  bg: "#f4f7f1",
  surface: "#ffffff",
  surface2: "#eef3ea",
  surface3: "#e2eadc",
  line: "#dfe7da",
  lineStrong: "#c6d3bf",
  ink: "#0f1a12",
  muted: "#55665a",
  faint: "#8a998e",
  accent: "#b8f23f",
  accentInk: "#0a0e0b",
  accentText: "#3a7d14",
  pitch: "#2f8a4c",
  pitchDeep: "#1d5e32",
  danger: "#d64545",
  warning: "#b86e00",
  success: "#1f9d55",
  info: "#2b6cb0",
  mine: "#dcf8b9",
  shadow: "#0f1a12",
};

const dark: Palette = {
  scheme: "dark",
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
  accentText: "#b8f23f",
  pitch: "#1f6b3a",
  pitchDeep: "#123f22",
  danger: "#ff6b6b",
  warning: "#ffb547",
  success: "#4ade80",
  info: "#6cb8ff",
  mine: "#1f4d2b",
  shadow: "#000000",
};

export type ThemeMode = "system" | "light" | "dark";

export const fonts = {
  regular: "Cairo_400Regular",
  semibold: "Cairo_600SemiBold",
  bold: "Cairo_700Bold",
} as const;

export const radius = { card: 20, pill: 999 } as const;

interface ThemeState {
  colors: Palette;
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
}

const KEY = "malaab.theme";
const ThemeContext = createContext<ThemeState>({ colors: light, mode: "system", setMode: () => undefined });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const device = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>("system");
  useEffect(() => {
    void AsyncStorage.getItem(KEY)
      .then((saved) => {
        if (saved === "light" || saved === "dark" || saved === "system") setModeState(saved);
      })
      .catch(() => undefined);
  }, []);
  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    void AsyncStorage.setItem(KEY, next).catch(() => undefined);
  }, []);
  const scheme = mode === "system" ? (device === "dark" ? "dark" : "light") : mode;
  const value = useMemo(() => ({ colors: scheme === "dark" ? dark : light, mode, setMode }), [scheme, mode, setMode]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
export const useColors = () => useContext(ThemeContext).colors;
