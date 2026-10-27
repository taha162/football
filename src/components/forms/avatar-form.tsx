"use client";

import { useTranslations } from "next-intl";
import { ActionForm, FormField, SubmitButton } from "@/components/ui/action-form";
import { Input } from "@/components/ui/field";
import { removeAvatarAction, uploadAvatarAction } from "@/server/profile";

export function AvatarForm({ hasAvatar }: { hasAvatar: boolean }) {
  const t = useTranslations("profile");
  return (
    <div className="flex flex-col gap-3">
      <ActionForm action={uploadAvatarAction} resetOnSuccess>
        <FormField name="avatar" label={t("photo")} hint={t("photoHint")}>
          {(a) => <Input {...a} type="file" accept="image/jpeg,image/png,image/webp" required className="py-2" />}
        </FormField>
        <SubmitButton variant="secondary" className="self-start">
          {t("uploadPhoto")}
        </SubmitButton>
      </ActionForm>
      {hasAvatar ? (
        <ActionForm action={removeAvatarAction}>
          <SubmitButton variant="ghost" size="sm" className="self-start">
            {t("removePhoto")}
          </SubmitButton>
        </ActionForm>
      ) : null}
    </div>
  );
}
