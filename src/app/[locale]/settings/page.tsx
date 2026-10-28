import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { Link } from "@/i18n/navigation";
import { requireUser } from "@/lib/auth";
import { OPTIONAL_NOTIFICATION_TYPES } from "@/lib/notifications";
import { isPhoneAccountEmail } from "@/lib/phone";
import { createClient } from "@/lib/supabase/server";
import { blockUserAction, savePreferencesAction } from "@/server/profile";
import { signOutAction } from "@/server/auth";
import { ActionForm, InlineAction, SubmitButton } from "@/components/ui/action-form";
import { buttonClass } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { Card, CardBody, Container, DefinitionList, PageHeader, Section } from "@/components/ui/primitives";

export default async function SettingsPage({ params }: PageProps<"/[locale]/settings">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireUser(locale as Locale, "/settings");
  const t = await getTranslations("settings");
  const nt = await getTranslations("notificationTypes");
  const supabase = await createClient();
  const [{ data: prefs }, { data: blocks }, { data: phone }] = await Promise.all([
    supabase.from("user_preferences").select("*").eq("user_id", user.id).maybeSingle(),
    supabase.from("user_blocks").select("blocked_id, profile:profiles!user_blocks_blocked_id_fkey(display_name)").eq("blocker_id", user.id),
    supabase.rpc("my_phone"),
  ]);
  // WhatsApp accounts have only an internal auth address; show their verified number instead.
  const phoneAccount = isPhoneAccountEmail(user.email);
  const muted = new Set(Object.entries((prefs?.notification_prefs ?? {}) as Record<string, boolean>).filter(([, v]) => v === false).map(([k]) => k));

  return (
    <Container className="flex max-w-3xl flex-col gap-10 py-10">
      <PageHeader title={t("title")} />
      <Section title={t("account")} id="account">
        <Card>
          <CardBody className="flex flex-col gap-4">
            <DefinitionList
              items={[
                ...(phoneAccount
                  ? []
                  : [
                      { label: t("email"), value: <span dir="ltr">{user.email}</span> },
                      { label: t("emailStatus"), value: user.emailConfirmed ? t("confirmed") : t("unconfirmed") },
                    ]),
                ...(phone ? [{ label: t("phone"), value: <span dir="ltr">+{phone} · {t("phoneVerified")}</span> }] : []),
              ]}
            />
            <div className="flex flex-wrap gap-2">
              <Link href="/profile" className={buttonClass("secondary", "sm")}>{t("editProfile")}</Link>
              <Link href="/forgot-password" className={buttonClass("ghost", "sm")}>{t("changePassword")}</Link>
              <form action={signOutAction}>
                <button type="submit" className={buttonClass("ghost", "sm")}>{t("signOut")}</button>
              </form>
            </div>
            <p className="text-xs text-muted">{t("deleteNote")}</p>
          </CardBody>
        </Card>
      </Section>

      <Section title={t("preferences")} id="preferences">
        <Card>
          <CardBody>
            <ActionForm action={savePreferencesAction}>
              <label className="flex flex-col gap-1 text-sm">
                {t("language")}
                <Select name="locale" defaultValue={prefs?.locale ?? locale}>
                  <option value="ar">العربية</option>
                  <option value="en">English</option>
                </Select>
              </label>
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1 text-sm font-medium">{t("notifications")}</legend>
                <p className="text-xs text-muted">{t("notificationsHint")}</p>
                {OPTIONAL_NOTIFICATION_TYPES.map((type) => (
                  <label key={type} className="flex min-h-10 items-center justify-between gap-3 border-b border-line text-sm last:border-0">
                    <span>{nt(type)}</span>
                    <span className="flex items-center gap-2 text-xs text-muted">
                      {t("mute")}
                      <input type="checkbox" name="muted" value={type} defaultChecked={muted.has(type)} className="size-5 accent-[var(--color-accent)]" />
                    </span>
                  </label>
                ))}
              </fieldset>
              <SubmitButton className="self-start">{t("save")}</SubmitButton>
            </ActionForm>
          </CardBody>
        </Card>
      </Section>

      <Section title={t("blocked")} id="blocked">
        {(blocks ?? []).length === 0 ? (
          <p className="text-sm text-muted">{t("noBlocked")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {(blocks ?? []).map((b) => (
              <li key={b.blocked_id} className="flex items-center justify-between rounded-xl border border-line p-3 text-sm">
                {b.profile?.display_name}
                <InlineAction action={blockUserAction} values={{ user_id: b.blocked_id, unblock: "1" }} label={t("unblock")} variant="ghost" />
              </li>
            ))}
          </ul>
        )}
      </Section>
    </Container>
  );
}
