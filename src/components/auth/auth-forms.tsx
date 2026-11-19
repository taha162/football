"use client";

import type { ComponentProps } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { ActionForm, FormField, Hidden, SubmitButton } from "@/components/ui/action-form";
import { Checkbox, Input } from "@/components/ui/field";
import { PasswordInput } from "@/components/ui/password-input";
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
import { startWhatsappResetAction, startWhatsappSignupAction } from "@/server/whatsapp";
import { useActionMessage } from "@/components/ui/use-action-message";

/**
 * The WhatsApp number (the main way) or the e-mail, and the password. A
 * number signs in accounts made with it, whether or not the WhatsApp bot is
 * set up. «نسيتها؟» sits beside the password's label, the eye in its field.
 * Both fields are required (on the inputs); no asterisks, as there's nothing optional.
 */
export function SignInForm({ next, method }: { next?: string; method: "whatsapp" | "email" }) {
  const t = useTranslations("auth");
  const forgot = (
    <Link href="/forgot-password" className="text-sm font-medium text-accent hover:underline">
      {t("forgotLink")}
    </Link>
  );
  return (
    <ActionForm action={signInAction}>
      <Hidden values={{ next }} />
      {method === "whatsapp" ? (
        <FormField name="phone" label={t("waPhone")}>
          {(a) => <WhatsappNumberInput {...a} autoComplete="username" />}
        </FormField>
      ) : (
        <FormField name="email" label={t("email")}>
          {(a) => (
            <Input {...a} type="email" inputMode="email" autoComplete="username" autoCapitalize="none" spellCheck={false} required dir="ltr" placeholder="name@example.com" />
          )}
        </FormField>
      )}
      <FormField name="password" label={t("password")} aside={forgot}>
        {(a) => <PasswordInput {...a} autoComplete="current-password" required />}
      </FormField>
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
        {(a) => <PasswordInput {...a} autoComplete="new-password" required minLength={8} maxLength={72} />}
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
 * Sign-up with a WhatsApp number instead of an e-mail: name, the number,
 * password and terms. The code must then come from that number's WhatsApp.
 * With WhatsApp messages set up, offers on WhatsApp come with it: the box is
 * ticked and can't be unticked here, and Settings turns them off afterwards.
 */
export function WhatsappSignUpForm({ offerPromos = false }: { offerPromos?: boolean }) {
  const t = useTranslations("auth");
  return (
    <ActionForm action={startWhatsappSignupAction}>
      <Alert tone="info">{t("whatsappSignupNote")}</Alert>
      <FormField name="display_name" label={t("displayName")} hint={t("displayNameHint")} required>
        {(a) => <Input {...a} autoComplete="nickname" required minLength={2} maxLength={40} />}
      </FormField>
      <FormField
        name="phone"
        label={t("waPhone")}
        // The example number stays left to right inside the Arabic sentence.
        hint={t.rich("waPhoneHint", { num: (c) => <bdi dir="ltr">{c}</bdi> })}
        required
      >
        {(a) => <WhatsappNumberInput {...a} />}
      </FormField>
      <FormField name="password" label={t("password")} hint={t("passwordHint")} required>
        {(a) => <PasswordInput {...a} autoComplete="new-password" required minLength={8} maxLength={72} />}
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
        // Part of signing up with WhatsApp: ticked, and it can't be unticked here. After signing
        // up, Settings (or sending 0) turns offers off. The server records it whatever the form says.
        <FormField name="wa_promos" label={t("promosHeading")} hint={t("promosHint")}>
          {(a) => <Checkbox {...a} defaultChecked disabled className="cursor-default" label={t("promosOptIn")} />}
        </FormField>
      ) : null}
      <SubmitButton size="lg">{t("continueWhatsapp")}</SubmitButton>
    </ActionForm>
  );
}

/** A WhatsApp number as people write it in Iraq (07…), or with its country code. */
function WhatsappNumberInput(props: ComponentProps<typeof Input>) {
  // `autoComplete` can be overridden: on the sign-in form the number is the account's user name.
  return <Input type="tel" inputMode="tel" autoComplete="tel" required maxLength={20} dir="ltr" placeholder="07XX XXX XXXX" {...props} />;
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

export function WhatsappResetForm() {
  const t = useTranslations("auth");
  return (
    <ActionForm action={startWhatsappResetAction}>
      <p className="text-sm text-muted">{t("forgotWhatsappNote")}</p>
      <FormField name="phone" label={t("waPhone")} hint={t("waPhoneResetHint")} required>
        {(a) => <WhatsappNumberInput {...a} />}
      </FormField>
      <SubmitButton size="lg">{t("forgotWhatsapp")}</SubmitButton>
    </ActionForm>
  );
}

/** `secondary`: under the WhatsApp recovery, the other way. */
export function ForgotPasswordForm({ secondary = false }: { secondary?: boolean }) {
  const t = useTranslations("auth");
  const message = useActionMessage();
  return (
    <ActionForm action={forgotPasswordAction} successMessage={message("reset_sent")} hideSuccess={false}>
      <FormField name="email" label={t("email")} required>
        {(a) => <Input {...a} type="email" autoComplete="email" required dir="ltr" />}
      </FormField>
      <SubmitButton size="lg" variant={secondary ? "outline" : "primary"}>{t("sendReset")}</SubmitButton>
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
        {(a) => <PasswordInput {...a} autoComplete="new-password" required minLength={8} />}
      </FormField>
      <FormField name="confirm" label={t("confirmPassword")} required>
        {(a) => <PasswordInput {...a} autoComplete="new-password" required minLength={8} />}
      </FormField>
      <SubmitButton size="lg">{t("savePassword")}</SubmitButton>
    </ActionForm>
  );
}
