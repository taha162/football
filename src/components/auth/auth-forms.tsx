"use client";

import type { ComponentProps } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { ActionForm, FormField, Hidden, SubmitButton } from "@/components/ui/action-form";
import { Checkbox, Input } from "@/components/ui/field";
import { Alert } from "@/components/ui/primitives";
import {
  forgotPasswordAction,
  resendEmailCodeAction,
  resetPasswordAction,
  signInAction,
  signUpAction,
  verifyEmailCodeAction,
} from "@/server/auth";
import { verifySecondFactorAction } from "@/server/mfa";
import { startTelegramResetAction, startTelegramSignupAction } from "@/server/telegram";
import { startWhatsappResetAction, startWhatsappSignupAction } from "@/server/whatsapp";
import { useActionMessage } from "@/components/ui/use-action-message";

export function SignInForm({ next, allowPhone = false }: { next?: string; allowPhone?: boolean }) {
  const t = useTranslations("auth");
  return (
    <ActionForm action={signInAction}>
      <Hidden values={{ next }} />
      <FormField name="email" label={allowPhone ? t("emailOrPhone") : t("email")} hint={allowPhone ? t("emailOrPhoneHint") : undefined} required>
        {(a) =>
          allowPhone ? (
            <Input {...a} type="text" autoComplete="username" autoCapitalize="none" spellCheck={false} required dir="ltr" />
          ) : (
            <Input {...a} type="email" autoComplete="email" inputMode="email" required dir="ltr" />
          )
        }
      </FormField>
      <FormField name="password" label={t("password")} required>
        {(a) => <Input {...a} type="password" autoComplete="current-password" required dir="ltr" />}
      </FormField>
      <div className="flex justify-end">
        <Link href="/forgot-password" className="text-sm text-accent hover:underline">
          {t("forgotLink")}
        </Link>
      </div>
      <SubmitButton size="lg">{t("signIn")}</SubmitButton>
    </ActionForm>
  );
}

export function SignUpForm() {
  const t = useTranslations("auth");
  const message = useActionMessage();
  return (
    <ActionForm action={signUpAction} successMessage={message("check_email")}>
      <FormField name="display_name" label={t("displayName")} hint={t("displayNameHint")} required>
        {(a) => <Input {...a} autoComplete="nickname" required minLength={2} maxLength={40} />}
      </FormField>
      <FormField name="email" label={t("email")} required>
        {(a) => <Input {...a} type="email" autoComplete="email" inputMode="email" required dir="ltr" />}
      </FormField>
      <FormField name="password" label={t("password")} hint={t("passwordHint")} required>
        {(a) => <Input {...a} type="password" autoComplete="new-password" required minLength={8} maxLength={72} dir="ltr" />}
      </FormField>
      <FormField name="accept_terms" label={t("termsHeading")}>
        {(a) => (
          <Checkbox
            {...a}
            required
            label={t.rich("acceptTerms", {
              terms: (c) => <Link href="/legal/terms" className="text-accent underline">{c}</Link>,
              privacy: (c) => <Link href="/legal/privacy" className="text-accent underline">{c}</Link>,
            })}
          />
        )}
      </FormField>
      <SubmitButton size="lg">{t("createAccount")}</SubmitButton>
    </ActionForm>
  );
}

/**
 * Name + password + terms for the sign-ups that verify a phone number (the
 * number itself comes from the bot). With WhatsApp messages set up, an
 * unticked box asks whether to receive offers on WhatsApp.
 */
function PhoneSignUpForm({
  action,
  note,
  submit,
  offerPromos,
}: {
  action: typeof startTelegramSignupAction;
  note: string;
  submit: string;
  offerPromos: boolean;
}) {
  const t = useTranslations("auth");
  return (
    <ActionForm action={action}>
      <Alert tone="info">{note}</Alert>
      <FormField name="display_name" label={t("displayName")} hint={t("displayNameHint")} required>
        {(a) => <Input {...a} autoComplete="nickname" required minLength={2} maxLength={40} />}
      </FormField>
      <FormField name="password" label={t("password")} hint={t("passwordHint")} required>
        {(a) => <Input {...a} type="password" autoComplete="new-password" required minLength={8} maxLength={72} dir="ltr" />}
      </FormField>
      <FormField name="accept_terms" label={t("termsHeading")}>
        {(a) => (
          <Checkbox
            {...a}
            required
            label={t.rich("acceptTerms", {
              terms: (c) => <Link href="/legal/terms" className="text-accent underline">{c}</Link>,
              privacy: (c) => <Link href="/legal/privacy" className="text-accent underline">{c}</Link>,
            })}
          />
        )}
      </FormField>
      {offerPromos ? (
        <FormField name="wa_promos" label={t("promosHeading")} hint={t("promosHint")}>
          {(a) => <Checkbox {...a} label={t("promosOptIn")} />}
        </FormField>
      ) : null}
      <SubmitButton size="lg">{submit}</SubmitButton>
    </ActionForm>
  );
}

/** The phone number comes from Telegram itself. */
export function TelegramSignUpForm({ offerPromos = false }: { offerPromos?: boolean }) {
  const t = useTranslations("auth");
  return <PhoneSignUpForm action={startTelegramSignupAction} note={t("telegramSignupNote")} submit={t("continueTelegram")} offerPromos={offerPromos} />;
}

/** The phone number is the one the user sends the code from. */
export function WhatsappSignUpForm({ offerPromos = false }: { offerPromos?: boolean }) {
  const t = useTranslations("auth");
  return <PhoneSignUpForm action={startWhatsappSignupAction} note={t("whatsappSignupNote")} submit={t("continueWhatsapp")} offerPromos={offerPromos} />;
}

export function VerifyEmailForm() {
  const t = useTranslations("auth");
  const message = useActionMessage();
  return (
    <div className="flex flex-col gap-4">
      <ActionForm action={verifyEmailCodeAction}>
        <FormField name="code" label={t("code")} hint={t("codeHint")} required>
          {(a) => (
            <Input
              {...a}
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6,10}"
              maxLength={10}
              required
              autoFocus
              dir="ltr"
              className="text-center font-display text-2xl tracking-[0.4em]"
            />
          )}
        </FormField>
        <SubmitButton size="lg">{t("verify")}</SubmitButton>
      </ActionForm>
      <ActionForm action={resendEmailCodeAction} successMessage={message("code_sent")} className="items-center">
        <SubmitButton variant="ghost" size="sm">{t("resendCode")}</SubmitButton>
      </ActionForm>
    </div>
  );
}

/** The six digits an authenticator app shows: typed by hand or filled in by the phone. */
export function AppCodeInput(props: ComponentProps<typeof Input>) {
  return (
    <Input
      {...props}
      inputMode="numeric"
      autoComplete="one-time-code"
      pattern="[0-9 ]{6,7}"
      maxLength={7}
      required
      dir="ltr"
      className="text-center font-display text-2xl tracking-[0.4em]"
    />
  );
}

export function SecondStepForm({ next }: { next: string }) {
  const t = useTranslations("auth");
  return (
    <ActionForm action={verifySecondFactorAction}>
      <Hidden values={{ next }} />
      <FormField name="code" label={t("appCode")} hint={t("appCodeHint")} required>
        {(a) => <AppCodeInput {...a} autoFocus />}
      </FormField>
      <SubmitButton size="lg">{t("verify")}</SubmitButton>
    </ActionForm>
  );
}

export function TelegramResetForm() {
  const t = useTranslations("auth");
  return (
    <ActionForm action={startTelegramResetAction}>
      <p className="text-sm text-muted">{t("forgotTelegramNote")}</p>
      <SubmitButton size="lg" variant="secondary">{t("forgotTelegram")}</SubmitButton>
    </ActionForm>
  );
}

export function WhatsappResetForm() {
  const t = useTranslations("auth");
  return (
    <ActionForm action={startWhatsappResetAction}>
      <p className="text-sm text-muted">{t("forgotWhatsappNote")}</p>
      <SubmitButton size="lg" variant="secondary">{t("forgotWhatsapp")}</SubmitButton>
    </ActionForm>
  );
}

export function ForgotPasswordForm() {
  const t = useTranslations("auth");
  const message = useActionMessage();
  return (
    <ActionForm action={forgotPasswordAction} successMessage={message("reset_sent")} hideSuccess={false}>
      <FormField name="email" label={t("email")} required>
        {(a) => <Input {...a} type="email" autoComplete="email" required dir="ltr" />}
      </FormField>
      <SubmitButton size="lg">{t("sendReset")}</SubmitButton>
    </ActionForm>
  );
}

export function ResetPasswordForm({ hasSession }: { hasSession: boolean }) {
  const t = useTranslations("auth");
  if (!hasSession) {
    return (
      <Alert tone="warning" title={t("resetExpiredTitle")}>
        <Link href="/forgot-password" className="text-accent underline">{t("resetExpiredAction")}</Link>
      </Alert>
    );
  }
  return (
    <ActionForm action={resetPasswordAction}>
      <FormField name="password" label={t("newPassword")} hint={t("passwordHint")} required>
        {(a) => <Input {...a} type="password" autoComplete="new-password" required minLength={8} dir="ltr" />}
      </FormField>
      <FormField name="confirm" label={t("confirmPassword")} required>
        {(a) => <Input {...a} type="password" autoComplete="new-password" required minLength={8} dir="ltr" />}
      </FormField>
      <SubmitButton size="lg">{t("savePassword")}</SubmitButton>
    </ActionForm>
  );
}
