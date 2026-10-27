"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { ActionForm, FormField, Hidden, SubmitButton } from "@/components/ui/action-form";
import { Checkbox, Input } from "@/components/ui/field";
import { Alert } from "@/components/ui/primitives";
import { forgotPasswordAction, resetPasswordAction, signInAction, signUpAction } from "@/server/auth";
import { useActionMessage } from "@/components/ui/use-action-message";

export function SignInForm({ next }: { next?: string }) {
  const t = useTranslations("auth");
  return (
    <ActionForm action={signInAction}>
      <Hidden values={{ next }} />
      <FormField name="email" label={t("email")} required>
        {(a) => <Input {...a} type="email" autoComplete="email" inputMode="email" required dir="ltr" />}
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
