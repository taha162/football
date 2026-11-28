import { useMemo, type ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps, type TextProps, type ViewStyle } from "react-native";
import { Image } from "expo-image";
import { fonts, radius, useColors, type Palette } from "./theme";

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    // "left" is the start of the line: React Native swaps it in a right-to-left layout.
    text: { color: c.ink, fontSize: 15, textAlign: "left", writingDirection: "rtl" },
    screen: { flex: 1, backgroundColor: c.bg },
    card: {
      backgroundColor: c.surface,
      borderColor: c.line,
      borderWidth: 1,
      borderRadius: radius.card,
      padding: 16,
      gap: 8,
      shadowColor: c.shadow,
      shadowOpacity: c.scheme === "light" ? 0.06 : 0,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 4 },
      elevation: c.scheme === "light" ? 2 : 0,
    },
    pressed: { opacity: 0.88, transform: [{ scale: 0.985 }] },
    button: { minHeight: 50, borderRadius: radius.pill, alignItems: "center", justifyContent: "center", paddingHorizontal: 22 },
    primary: { backgroundColor: c.accent },
    secondary: { backgroundColor: c.surface2, borderWidth: 1, borderColor: c.lineStrong },
    danger: { backgroundColor: `${c.danger}14`, borderWidth: 1, borderColor: `${c.danger}66` },
    ghost: { backgroundColor: "transparent" },
    disabled: { opacity: 0.5 },
    input: {
      minHeight: 50,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: c.lineStrong,
      backgroundColor: c.surface,
      color: c.ink,
      paddingHorizontal: 14,
      fontFamily: fonts.regular,
      fontSize: 16,
      textAlign: "left",
    },
    notice: { borderWidth: 1, borderRadius: 14, padding: 12 },
    avatar: { backgroundColor: c.surface3, alignItems: "center", justifyContent: "center", overflow: "hidden" },
    center: { flex: 1, alignItems: "center", justifyContent: "center" },
    badge: { borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 2, alignSelf: "flex-start" },
  });

/** The kit's styles for the palette in use (made once per palette). */
export function useStyles() {
  const colors = useColors();
  return useMemo(() => makeStyles(colors), [colors]);
}

/** Text in Cairo, right to left. */
export function T({ style, weight = "regular", muted, ...props }: TextProps & { weight?: keyof typeof fonts; muted?: boolean }) {
  const s = useStyles();
  const colors = useColors();
  return <Text {...props} style={[s.text, { fontFamily: fonts[weight] }, muted && { color: colors.muted }, style]} />;
}

export function Screen({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const s = useStyles();
  return <View style={[s.screen, style]}>{children}</View>;
}

export function Card({ children, style, onPress, label }: { children: ReactNode; style?: ViewStyle; onPress?: () => void; label?: string }) {
  const s = useStyles();
  if (!onPress) return <View style={[s.card, style]}>{children}</View>;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.card, pressed && s.pressed, style]} accessibilityRole="button" accessibilityLabel={label}>
      {children}
    </Pressable>
  );
}

export function Button({
  label,
  onPress,
  variant = "primary",
  busy,
  disabled,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  busy?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
}) {
  const s = useStyles();
  const colors = useColors();
  const look = variant === "primary" ? s.primary : variant === "danger" ? s.danger : variant === "ghost" ? s.ghost : s.secondary;
  const ink = variant === "primary" ? colors.accentInk : variant === "danger" ? colors.danger : colors.ink;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || busy, busy }}
      style={({ pressed }) => [s.button, look, (disabled || busy) && s.disabled, pressed && s.pressed, style]}
    >
      {busy ? <ActivityIndicator color={ink} /> : <T weight="bold" style={{ color: ink, fontSize: 16 }}>{label}</T>}
    </Pressable>
  );
}

export function Field({ label, error, hint, ...input }: TextInputProps & { label: string; error?: string | null; hint?: string }) {
  const s = useStyles();
  const colors = useColors();
  return (
    <View style={{ gap: 6 }}>
      <T weight="semibold">{label}</T>
      <TextInput
        placeholderTextColor={colors.faint}
        accessibilityLabel={label}
        {...input}
        style={[s.input, error ? { borderColor: colors.danger } : null, input.style]}
      />
      {error ? <T style={{ color: colors.danger, fontSize: 13 }}>{error}</T> : hint ? <T muted style={{ fontSize: 13 }}>{hint}</T> : null}
    </View>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "danger" | "success" | "warning"; children: ReactNode }) {
  const s = useStyles();
  const colors = useColors();
  const tint = { info: colors.info, danger: colors.danger, success: colors.success, warning: colors.warning }[tone];
  return (
    <View accessibilityRole="alert" style={[s.notice, { borderColor: `${tint}55`, backgroundColor: `${tint}18` }]}>
      <T style={{ color: tint }}>{children}</T>
    </View>
  );
}

export function Avatar({ uri, name, size = 44 }: { uri: string | null; name: string; size?: number }) {
  const s = useStyles();
  const colors = useColors();
  const letters = name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  return (
    <View style={[s.avatar, { width: size, height: size, borderRadius: size / 2 }]}>
      {uri ? <Image source={uri} style={{ width: size, height: size, borderRadius: size / 2 }} contentFit="cover" transition={150} /> : <T weight="bold" style={{ color: colors.muted }}>{letters}</T>}
    </View>
  );
}

export function Loading() {
  const s = useStyles();
  const colors = useColors();
  return (
    <View style={s.center}>
      <ActivityIndicator color={colors.accentText} size="large" />
    </View>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  const s = useStyles();
  return (
    <View style={[s.center, { gap: 12, padding: 32 }]}>
      <T weight="bold" style={{ fontSize: 18, textAlign: "center" }}>{title}</T>
      {children}
    </View>
  );
}

export function Badge({ label, tone = "neutral" }: { label: string; tone?: "neutral" | "accent" | "warning" }) {
  const s = useStyles();
  const colors = useColors();
  const bg = tone === "accent" ? `${colors.accent}33` : tone === "warning" ? `${colors.warning}22` : colors.surface3;
  const ink = tone === "accent" ? colors.accentText : tone === "warning" ? colors.warning : colors.muted;
  return (
    <View style={[s.badge, { backgroundColor: bg }]}>
      <T weight="semibold" style={{ color: ink, fontSize: 12 }}>{label}</T>
    </View>
  );
}
