import { ScrollView, View } from "react-native";
import { useLocalSearchParams, useNavigation } from "expo-router";
import { useEffect } from "react";
import texts from "../../src/lib/site-texts.json";
import { Empty, T } from "../../src/ui/kit";

const KEYS: Record<string, string> = { terms: "terms", privacy: "privacy", safety: "safety", "account-deletion": "accountDeletion" };
type Page = { title: string; intro: string; sections: { heading: string; body: string }[] };

/** The site's policy pages (the same texts), inside the app. */
export default function Legal() {
  const { page } = useLocalSearchParams<{ page: string }>();
  const navigation = useNavigation();
  const content = (texts as unknown as { legal: Record<string, Page> }).legal[KEYS[page ?? ""] ?? ""];
  useEffect(() => {
    if (content) navigation.setOptions({ title: content.title });
  }, [content, navigation]);
  if (!content) return <Empty title="الصفحة غير موجودة" />;
  return (
    <ScrollView contentContainerStyle={{ padding: 20, gap: 18 }}>
      <T muted>{content.intro}</T>
      {content.sections.map((s) => (
        <View key={s.heading} style={{ gap: 6 }}>
          <T weight="bold" style={{ fontSize: 17 }}>{s.heading}</T>
          <T muted>{s.body}</T>
        </View>
      ))}
    </ScrollView>
  );
}
