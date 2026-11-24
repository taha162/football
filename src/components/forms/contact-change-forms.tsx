"use client";

import { useTranslations } from "next-intl";
import { confirmEmailChangeAction, resendEmailChangeAction, startEmailChangeAction, startPhoneChangeAction } from "@/server/account";
import { ActionForm, FormField, SubmitButton, SubmitWhenReady } from "@/components/ui/action-form";
import { Input } from "@/components/ui/field";
import { OtpInput } from "@/components/ui/otp-input";
import { PasswordInput } from "@/components/ui/password-input";
import { Alert } from "@/components/ui/primitives";
import { useActionMessage } from "@/components/ui/use-action-message";

/** The account's password, asked before an address changes (server/account.ts). */
function CurrentPassword({ id }: { id: string }) {
  const t = useTranslations("settings");
  return (
    <FormField name="current_password" id={id} label={t("currentPassword")} hint={t("currentPasswordHint")} required>
      {(a) => <PasswordInput {...a} autoComplete="current-password" required />}
    </FormField>
  );
}

/**
 * E-mail: a new address and the password, then the code e-mailed to it. When
 * Supabase also e-mails the current address (its «Secure email change»), the
 * page then asks for that code too.
 */
export function EmailChangeForms({
  pending,
  current,
  waitingForCurrent,
}: {
  /** The address waiting to be confirmed, if any. */
  pending: string | null;
  /** The account's real address; null for an account made with WhatsApp. */
  current: string | null;
  /** The new address is confirmed; the code sent to the current one is still needed. */
  waitingForCurrent: boolean;
}) {
  const t = useTranslations("settings");
  const message = useActionMessage();
  const start = (
    <ActionForm action={startEmailChangeAction} className="gap-4">
      <FormField name="email" id="new-email" label={t("newEmail")} required>
        {(a) => <Input {...a} type="email" inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false} required dir="ltr" placeholder="name@example.com" />}
      </FormField>
      <CurrentPassword id="email-current-password" />
      <SubmitButton className="self-start">{t("sendEmailCode")}</SubmitButton>
    </ActionForm>
  );
  if (!pending) return start;
  return (
    <div className="flex flex-col gap-4">
      <Alert tone="info">
        {waitingForCurrent && current
          ? t.rich("emailCodeCurrent", { email: current, b: (c) => <bdi dir="ltr" className="font-semibold">{c}</bdi> })
          : t.rich("emailCodeSent", { email: pending, b: (c) => <bdi dir="ltr" className="font-semibold">{c}</bdi> })}
      </Alert>
      <ActionForm action={confirmEmailChangeAction} className="gap-4">
        <FormField name="code" id="email-change-code" label={t("emailCode")} required>
          {(a) => <OtpInput {...a} length={6} maxLength={10} required />}
        </FormField>
        <SubmitWhenReady className="self-start">{t("confirmEmail")}</SubmitWhenReady>
      </ActionForm>
      <ActionForm action={resendEmailChangeAction} successMessage={message("code_sent")} className="items-start">
        <SubmitButton variant="ghost" size="sm">{t("resendEmailCode")}</SubmitButton>
      </ActionForm>
      <details className="rounded-xl border border-line px-4 py-3">
        <summary className="cursor-pointer text-sm font-medium">{t("otherEmail")}</summary>
        <div className="pt-4">{start}</div>
      </details>
    </div>
  );
}

/** Phone: the number and the password; the code is then sent from that number's WhatsApp (the waiting page). */
export function PhoneChangeForm({ available }: { available: boolean }) {
  const t = useTranslations("settings");
  if (!available) return <p className="text-sm text-muted">{t("phoneChangeUnavailable")}</p>;
  return (
    <ActionForm action={startPhoneChangeAction} className="gap-4">
      <FormField name="phone" id="new-phone" label={t("newPhone")} hint={t("newPhoneHint")} required>
        {(a) => <Input {...a} type="tel" inputMode="tel" autoComplete="tel" required maxLength={20} dir="ltr" placeholder="07XX XXX XXXX" />}
      </FormField>
      <CurrentPassword id="phone-current-password" />
      <SubmitButton className="self-start">{t("verifyPhone")}</SubmitButton>
    </ActionForm>
  );
}
