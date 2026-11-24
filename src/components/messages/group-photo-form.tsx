"use client";

import { useTranslations } from "next-intl";
import { removeGroupPhotoAction, setGroupPhotoAction } from "@/server/groups";
import { ActionForm, FormField, Hidden, SubmitButton } from "@/components/ui/action-form";
import { Input } from "@/components/ui/field";

/** Admins: the group's photo, chosen (made smaller in the browser first, as every picture) or removed. */
export function GroupPhotoForm({ conversationId, hasPhoto }: { conversationId: string; hasPhoto: boolean }) {
  const t = useTranslations("groups");
  return (
    <div className="flex flex-col gap-3">
      <ActionForm action={setGroupPhotoAction} resetOnSuccess className="gap-3">
        <Hidden values={{ conversation_id: conversationId }} />
        <FormField name="photo" id="group-photo" label={hasPhoto ? t("changePhoto") : t("addPhoto")} hint={t("photoHint")}>
          {(a) => <Input {...a} type="file" accept="image/jpeg,image/png,image/webp" required className="py-2" />}
        </FormField>
        <SubmitButton variant="secondary" size="sm" className="self-start">{t("savePhoto")}</SubmitButton>
      </ActionForm>
      {hasPhoto ? (
        <ActionForm action={removeGroupPhotoAction}>
          <Hidden values={{ conversation_id: conversationId }} />
          <SubmitButton variant="ghost" size="sm" className="self-start">{t("removePhoto")}</SubmitButton>
        </ActionForm>
      ) : null}
    </div>
  );
}
