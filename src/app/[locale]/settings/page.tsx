import { cookies } from "next/headers";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { getAccountStatus, requireUser } from "@/lib/auth";
import { OPTIONAL_NOTIFICATION_TYPES } from "@/lib/notifications";
import { isPhoneAccountEmail } from "@/lib/phone";
import { createClient } from "@/lib/supabase/server";
import { whatsappConfig } from "@/lib/whatsapp";
import { blockUserAction, savePreferencesAction } from "@/server/profile";
import { saveWhatsappSettingsAction } from "@/server/whatsapp";
import { setUsernameAction } from "@/server/username";
import { UsernameField } from "@/components/forms/username-field";
import { EmailChangeForms, PhoneChangeForm } from "@/components/forms/contact-change-forms";
import { signOutAction } from "@/server/auth";
import { SecondFactorSettings } from "@/components/auth/second-factor-settings";
import { ActionForm, InlineAction, SubmitButton } from "@/components/ui/action-form";
import { Checkbox } from "@/components/ui/field";
import { buttonClass } from "@/components/ui/button";
import { Alert, Card, CardBody, Container, DefinitionList, PageHeader, Section } from "@/components/ui/primitives";
import { LinkButton } from "@/components/ui/link-button";

export default async function SettingsPage({ params, searchParams }: PageProps<"/[locale]/settings">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireUser(locale as Locale, "/settings");
  const account = await getAccountStatus();
  const t = await getTranslations("settings");
  const nt = await getTranslations("notificationTypes");
  const supabase = await createClient();
  const [{ data: prefs }, { data: blocks }, { data: phone }, consent, { data: authUser }] = await Promise.all([
    supabase.from("user_preferences").select("*").eq("user_id", user.id).maybeSingle(),
    supabase.from("user_blocks").select("blocked_id, profile:profiles!user_blocks_blocked_id_fkey(display_name)").eq("blocker_id", user.id),
    supabase.rpc("my_phone"),
    supabase.from("whatsapp_consent").select("opted_in_at, opted_out_at, bookings_off_at").eq("user_id", user.id).maybeSingle(),
    // An e-mail change waiting for its code (Supabase keeps the new address until it is confirmed).
    supabase.auth.getUser(),
  ]);
  const pendingEmail = authUser.user?.new_email ?? null;
  const waitingForCurrent = (await cookies()).get("malaab_email_change_left")?.value === "current";
  const query = await searchParams;
  const phoneChanged = query.phone === "changed";
  const emailChanged = query.email === "changed";
  // WhatsApp messages need a verified number, the bot set up, and the database update (…0028).
  const whatsapp = phone && whatsappConfig().canSend && !consent.error ? (consent.data ?? { opted_in_at: null, opted_out_at: null, bookings_off_at: null }) : null;
  // Phone accounts have only an internal auth address; show their verified number instead.
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
                      { label: t("emailStatus"), value: account.emailConfirmed ? t("confirmed") : t("unconfirmed") },
                    ]),
                ...(phone ? [{ label: t("phone"), value: <span dir="ltr">+{phone} · {t("phoneVerified")}</span> }] : []),
              ]}
            />
            <div className="flex flex-wrap gap-2">
              <LinkButton href="/profile" className={buttonClass("secondary", "sm")}>{t("editProfile")}</LinkButton>
              <LinkButton href="/forgot-password" className={buttonClass("ghost", "sm")}>{t("changePassword")}</LinkButton>
              <form action={signOutAction}>
                <button type="submit" className={buttonClass("ghost", "sm")}>{t("signOut")}</button>
              </form>
            </div>
            <p className="text-xs text-muted">{t("deleteNote")}</p>
          </CardBody>
        </Card>
      </Section>

      {/* The account's e-mail: added (an account made with WhatsApp has none) or changed, with a code. */}
      <Section title={phoneAccount ? t("addEmail") : t("changeEmail")} id="email">
        <Card>
          <CardBody className="flex flex-col gap-4">
            {emailChanged ? <Alert tone="success">{t("emailChanged")}</Alert> : null}
            <EmailChangeForms pending={pendingEmail} current={phoneAccount ? null : (user.email ?? null)} waitingForCurrent={waitingForCurrent} />
          </CardBody>
        </Card>
      </Section>

      {/* The phone number: added or changed by sending a code from its WhatsApp (migrations 0046–0047). */}
      <Section title={phone ? t("changePhone") : t("addPhone")} id="phone">
        <Card>
          <CardBody className="flex flex-col gap-4">
            {phoneChanged ? <Alert tone="success">{t("phoneChanged")}</Alert> : null}
            <PhoneChangeForm available={whatsappConfig().enabled} />
          </CardBody>
        </Card>
      </Section>

      {/* Their username, for friends to find them (migration 0041; absent before it runs). */}
      {user.profile.username ? (
        <Section title={t("username")} id="username">
          <Card>
            <CardBody>
              <ActionForm action={setUsernameAction}>
                <UsernameField defaultValue={user.profile.username} />
                <SubmitButton className="self-start">{t("saveUsername")}</SubmitButton>
              </ActionForm>
            </CardBody>
          </Card>
        </Section>
      ) : null}

      <Section title={t("secondFactor")} id="two-step">
        <Card>
          <CardBody>
            <SecondFactorSettings enabled={account.secondFactor} />
          </CardBody>
        </Card>
      </Section>

      <Section title={t("preferences")} id="preferences">
        <Card>
          <CardBody>
            <ActionForm action={savePreferencesAction}>
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

      {whatsapp ? (
        <Section title={t("whatsapp")} id="whatsapp">
          <Card>
            <CardBody>
              <ActionForm action={saveWhatsappSettingsAction}>
                <p className="text-xs text-muted">{t("whatsappHint")}</p>
                <Checkbox name="wa_bookings" defaultChecked={!whatsapp.bookings_off_at} label={t("whatsappBookings")} />
                {/* Offers: part of signing up with WhatsApp; unticking here turns them off for good (until ticked again). */}
                <Checkbox name="wa_promos" defaultChecked={Boolean(whatsapp.opted_in_at && !whatsapp.opted_out_at)} label={t("whatsappPromos")} />
                <p className="text-xs text-muted">{t("whatsappStopHint")}</p>
                <SubmitButton className="self-start">{t("save")}</SubmitButton>
              </ActionForm>
            </CardBody>
          </Card>
        </Section>
      ) : null}

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
