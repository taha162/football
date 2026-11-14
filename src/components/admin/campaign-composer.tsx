"use client";

import { useId, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Send, X } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Button } from "@/components/ui/button";
import { Field, Select, Textarea } from "@/components/ui/field";
import { promoMessage } from "@/lib/whatsapp-messages";
import { startCampaignAction } from "@/server/whatsapp";

export interface AudienceOption {
  /** "" for everyone who opted in. */
  value: string;
  label: string;
  count: number;
}

/**
 * Writing a promotional message: the text, who receives it, a preview of the
 * message exactly as it will arrive, and a confirmation that says how many
 * people it goes to before anything is sent.
 */
export function CampaignComposer({ audiences, sampleName, disabled }: { audiences: AudienceOption[]; sampleName: string; disabled: boolean }) {
  const t = useTranslations("admin");
  const tc = useTranslations("common");
  const locale = useLocale();
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const text = useRef<HTMLTextAreaElement>(null);
  const titleId = useId();
  const bodyId = useId();
  const audienceId = useId();
  const chosen = audiences.find((a) => a.value === audience) ?? audiences[0];
  const preview = body.trim() ? promoMessage({ id: "preview", body, name: sampleName }) : "";

  return (
    <ActionForm
      action={startCampaignAction}
      onSuccess={() => {
        dialog.current?.close();
        setBody("");
      }}
    >
      <Field label={t("promoText")} htmlFor={bodyId} hint={t("promoTextHint")} required>
        <Textarea
          ref={text}
          id={bodyId}
          name="body"
          required
          minLength={5}
          maxLength={1000}
          rows={5}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
      </Field>
      <Field label={t("promoAudience")} htmlFor={audienceId}>
        <Select id={audienceId} name="city_id" value={audience} onChange={(e) => setAudience(e.target.value)}>
          {audiences.map((a) => (
            <option key={a.value || "all"} value={a.value}>
              {a.label}
            </option>
          ))}
        </Select>
      </Field>
      {preview ? (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs text-muted">{t("promoPreview")}</p>
          <p data-testid="promo-preview" className="max-w-sm whitespace-pre-wrap rounded-2xl rounded-ss-sm bg-[#d9fdd3] px-3 py-2 text-sm text-[#111b21] shadow-sm">
            {preview}
          </p>
        </div>
      ) : null}
      <Button
        type="button"
        className="self-start"
        disabled={disabled || chosen.count === 0}
        onClick={() => {
          if (text.current?.reportValidity()) dialog.current?.showModal();
        }}
        aria-haspopup="dialog"
      >
        <Send aria-hidden="true" className="size-4 rtl:-scale-x-100" />
        {t("promoSend")}
      </Button>
      <dialog ref={dialog} aria-labelledby={titleId} className="m-auto w-[min(92vw,28rem)] rounded-2xl border border-line bg-surface p-0 text-ink shadow-2xl">
        <div className="flex flex-col gap-4 p-5">
          <div className="flex items-start justify-between gap-3">
            <h2 id={titleId} className="font-display text-lg font-semibold">
              {t("promoConfirmTitle")}
            </h2>
            <Button variant="ghost" size="sm" onClick={() => dialog.current?.close()} aria-label={tc("close")}>
              <X aria-hidden="true" className="size-4" />
            </Button>
          </div>
          <p className="text-base font-semibold" data-testid="promo-recipients">
            {t("promoConfirmCount", { count: new Intl.NumberFormat(locale === "ar" ? "ar-IQ" : "en-GB").format(chosen.count) })}
          </p>
          <p className="text-sm text-muted">{t("promoConfirmBody")}</p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => dialog.current?.close()}>
              {tc("cancel")}
            </Button>
            <SubmitButton>{t("promoConfirm")}</SubmitButton>
          </div>
        </div>
      </dialog>
    </ActionForm>
  );
}
