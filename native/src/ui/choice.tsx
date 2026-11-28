import { Pressable, View } from "react-native";
import { T } from "./kit";
import { useColors } from "./theme";

/** Chips to pick one (radio) or several (checkbox) from. */
export function Choice<V extends string>({
  options,
  value,
  onChange,
  multiple,
}: {
  options: { value: V; label: string }[];
  value: V[] | V | null;
  onChange: (next: V[] | V) => void;
  multiple?: boolean;
}) {
  const colors = useColors();
  const chosen = (v: V) => (Array.isArray(value) ? value.includes(v) : value === v);
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }} accessibilityRole={multiple ? undefined : "radiogroup"}>
      {options.map((o) => {
        const on = chosen(o.value);
        return (
          <Pressable
            key={o.value}
            accessibilityRole={multiple ? "checkbox" : "radio"}
            accessibilityState={{ checked: on }}
            onPress={() => {
              if (!multiple) return onChange(o.value);
              const list = Array.isArray(value) ? value : [];
              onChange(on ? list.filter((x) => x !== o.value) : [...list, o.value]);
            }}
            style={{ borderRadius: 14, borderWidth: 1, borderColor: on ? colors.accentText : colors.line, backgroundColor: on ? `${colors.accent}33` : colors.surface, paddingHorizontal: 14, paddingVertical: 8 }}
          >
            <T weight="semibold">{o.label}</T>
          </Pressable>
        );
      })}
    </View>
  );
}
