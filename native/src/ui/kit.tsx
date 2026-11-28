import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps, type TextProps, type ViewStyle } from "react-native";
import { Image } from "expo-image";
import { colors, fonts, radius } from "./theme";

/** Text in Cairo, right to left. */
export function T({ style, weight = "regular", muted, ...props }: TextProps & { weight?: keyof typeof fonts; muted?: boolean }) {
  return <Text {...props} style={[styles.text, { fontFamily: fonts[weight] }, muted && { color: colors.muted }, style]} />;
}

export function Screen({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.screen, style]}>{children}</View>;
}

export function Card({ children, style, onPress }: { children: ReactNode; style?: ViewStyle; onPress?: () => void }) {
  if (!onPress) return <View style={[styles.card, style]}>{children}</View>;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.card, pressed && styles.pressed, style]} accessibilityRole="button">
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
  const look = variant === "primary" ? styles.primary : variant === "danger" ? styles.danger : variant === "ghost" ? styles.ghost : styles.secondary;
  const ink = variant === "primary" ? colors.accentInk : variant === "danger" ? colors.danger : colors.ink;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || busy, busy }}
      style={({ pressed }) => [styles.button, look, (disabled || busy) && styles.disabled, pressed && styles.pressed, style]}
    >
      {busy ? <ActivityIndicator color={ink} /> : <T weight="bold" style={{ color: ink, fontSize: 16 }}>{label}</T>}
    </Pressable>
  );
}

export function Field({ label, error, hint, ...input }: TextInputProps & { label: string; error?: string | null; hint?: string }) {
  return (
    <View style={{ gap: 6 }}>
      <T weight="semibold">{label}</T>
      <TextInput
        placeholderTextColor={colors.faint}
        accessibilityLabel={label}
        {...input}
        style={[styles.input, error ? { borderColor: colors.danger } : null, input.style]}
      />
      {error ? <T style={{ color: colors.danger, fontSize: 13 }}>{error}</T> : hint ? <T muted style={{ fontSize: 13 }}>{hint}</T> : null}
    </View>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "danger" | "success" | "warning"; children: ReactNode }) {
  const tint = { info: "#6cb8ff", danger: colors.danger, success: colors.success, warning: colors.warning }[tone];
  return (
    <View accessibilityRole="alert" style={[styles.notice, { borderColor: `${tint}55`, backgroundColor: `${tint}1f` }]}>
      <T style={{ color: tint }}>{children}</T>
    </View>
  );
}

export function Avatar({ uri, name, size = 44 }: { uri: string | null; name: string; size?: number }) {
  const letters = name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]}>
      {uri ? <Image source={uri} style={{ width: size, height: size, borderRadius: size / 2 }} contentFit="cover" transition={150} /> : <T weight="bold" style={{ color: colors.muted }}>{letters}</T>}
    </View>
  );
}

export function Loading() {
  return (
    <View style={styles.center}>
      <ActivityIndicator color={colors.accent} size="large" />
    </View>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <View style={[styles.center, { gap: 12, padding: 32 }]}>
      <T weight="bold" style={{ fontSize: 18, textAlign: "center" }}>{title}</T>
      {children}
    </View>
  );
}

export function Badge({ label, tone = "neutral" }: { label: string; tone?: "neutral" | "accent" | "warning" }) {
  const bg = tone === "accent" ? `${colors.accent}22` : tone === "warning" ? `${colors.warning}22` : colors.surface3;
  const ink = tone === "accent" ? colors.accent : tone === "warning" ? colors.warning : colors.muted;
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <T weight="semibold" style={{ color: ink, fontSize: 12 }}>{label}</T>
    </View>
  );
}

const styles = StyleSheet.create({
  text: { color: colors.ink, fontSize: 15, textAlign: "left", writingDirection: "rtl" },
  screen: { flex: 1, backgroundColor: colors.bg },
  card: { backgroundColor: colors.surface, borderColor: colors.line, borderWidth: 1, borderRadius: radius.card, padding: 16, gap: 8 },
  pressed: { opacity: 0.85, transform: [{ scale: 0.99 }] },
  button: { minHeight: 50, borderRadius: radius.pill, alignItems: "center", justifyContent: "center", paddingHorizontal: 22 },
  primary: { backgroundColor: colors.accent },
  secondary: { backgroundColor: colors.surface3, borderWidth: 1, borderColor: colors.lineStrong },
  danger: { backgroundColor: `${colors.danger}1f`, borderWidth: 1, borderColor: `${colors.danger}66` },
  ghost: { backgroundColor: "transparent" },
  disabled: { opacity: 0.5 },
  input: {
    minHeight: 50,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.surface2,
    color: colors.ink,
    paddingHorizontal: 14,
    fontFamily: fonts.regular,
    fontSize: 16,
    // "left" is the start of the line: React Native swaps it in a right-to-left layout.
    textAlign: "left",
  },
  notice: { borderWidth: 1, borderRadius: 14, padding: 12 },
  avatar: { backgroundColor: colors.surface3, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  badge: { borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 2, alignSelf: "flex-start" },
});
