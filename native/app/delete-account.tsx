import { useEffect, useState } from "react";
import { ScrollView, View } from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "../src/lib/auth";
import { siteApi } from "../src/lib/api";
import { errorText, fieldText } from "../src/lib/errors";
import { supabase } from "../src/lib/supabase";
import { Button, Card, Field, Loading, Notice, T } from "../src/ui/kit";

interface Preview {
  admin: boolean;
  owns_venues: string[];
  matches: number;
  tournaments: number;
  bookings: number;
  upcoming_bookings: number;
}

/**
 * Deleting the account (the stores require it in the app): the same steps and
 * checks as the site's Settings → «حذف الحساب» (/api/app/delete-account).
 */
export default function DeleteAccount() {
  const { signOut } = useAuth();
  const router = useRouter();
  const [preview, setPreview] = useState<Preview | null | undefined>(undefined);
  const [reason, setReason] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<{ name: string; error: string } | null>(null);

  useEffect(() => {
    void supabase()
      .rpc("my_account_deletion_preview")
      .then(({ data, error: e }) => setPreview(e ? null : (data as Preview)));
  }, []);

  const submit = async () => {
    setBusy(true);
    setError(null);
    setFieldError(null);
    const res = await siteApi<{ ok?: boolean }>("/api/app/delete-account", { reason, password, confirm }, true);
    setBusy(false);
    if (res.field) return setFieldError(res.field);
    if (!res.ok) return setError(res.error ?? "generic");
    await signOut().catch(() => undefined);
    router.replace("/sign-in");
  };

  if (preview === undefined) return <Loading />;
  const blocked = preview?.admin
    ? "أنت مدير في الموقع. اطلب من مدير آخر إزالة دور المدير عنك أولاً، ثم احذف حسابك."
    : preview?.owns_venues?.length
      ? `أنت مالك ملعب: ${preview.owns_venues.join("، ")}. انقل ملكيته إلى شخص آخر أو تواصل مع الإدارة أولاً.`
      : null;
  const fieldErr = (name: string) => (fieldError?.name === name ? fieldText(fieldError.error) : null);

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }} keyboardShouldPersistTaps="handled">
      <Card>
        <T weight="bold">يُحذف حسابك نهائياً، ولا يمكن استرجاعه.</T>
        <T muted>
          يُحذف معه: ملفك وصورتك ورقمك وبريدك، ورسائلك بصورها وتسجيلاتها، وأصدقاؤك ومكانك في المجموعات والفرق، والمباريات ({preview?.matches ?? 0}) والبطولات ({preview?.tournaments ?? 0}) التي نظّمتها.
        </T>
        <T muted>
          يبقى دون اسمك: حجوزاتك في سجل الملاعب ({preview?.bookings ?? 0}). القادمة منها ({preview?.upcoming_bookings ?? 0}) تُلغى ويُبلَّغ الملعب.
        </T>
      </Card>
      {preview === null ? <Notice tone="warning">{errorText("feature_not_ready")}</Notice> : null}
      {blocked ? (
        <Notice tone="warning">{blocked}</Notice>
      ) : preview ? (
        <View style={{ gap: 14 }}>
          {error ? <Notice tone="danger">{errorText(error)}</Notice> : null}
          <Field label="سبب الحذف (اختياري)" value={reason} onChangeText={setReason} multiline maxLength={500} />
          <Field label="كلمة المرور الحالية" secureTextEntry autoComplete="password" value={password} onChangeText={setPassword} error={fieldErr("current_password")} />
          <Field label="اكتب «حذف» للتأكيد" value={confirm} onChangeText={setConfirm} autoCorrect={false} error={fieldErr("confirm")} />
          <Button label="حذف حسابي نهائياً" variant="danger" onPress={submit} busy={busy} disabled={!password || !confirm} />
        </View>
      ) : null}
    </ScrollView>
  );
}
