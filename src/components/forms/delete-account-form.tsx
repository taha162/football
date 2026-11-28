"use client";

import { useTranslations } from "next-intl";
import { deleteMyAccountAction } from "@/server/account";
import { ActionForm, FormField, SubmitButton } from "@/components/ui/action-form";
import { Input, Textarea } from "@/components/ui/field";
import { CurrentPassword } from "@/components/forms/contact-change-forms";

/** Settings → «حذف الحساب»: an optional reason, the password and the word «حذف» (server/account.ts). */
export function DeleteAccountForm({ word }: { word: string }) {
  const t = useTranslations("settings");
  return (
    <ActionForm action={deleteMyAccountAction}>
      <FormField name="reason" id="delete-reason" label={t("deleteReason")}>
        {(a) => <Textarea {...a} rows={2} maxLength={500} />}
      </FormField>
      <CurrentPassword id="delete-password" />
      <FormField name="confirm" id="delete-confirm" label={t("deleteConfirm", { word })} required>
        {(a) => <Input {...a} required autoComplete="off" spellCheck={false} maxLength={20} />}
      </FormField>
      <SubmitButton variant="danger" className="self-start">{t("deleteSubmit")}</SubmitButton>
    </ActionForm>
  );
}
