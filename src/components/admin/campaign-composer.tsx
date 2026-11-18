"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ImageIcon, MapPin, Send, X } from "lucide-react";
import { ActionForm, FormField, SubmitButton } from "@/components/ui/action-form";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { promoMessage } from "@/lib/whatsapp-messages";
import { startCampaignAction } from "@/server/whatsapp";

export interface AudienceOption {
  /** "" for everyone who opted in. */
  value: string;
  label: string;
  count: number;
}

/** A venue with coordinates: a place a promotion can point to. */
export interface PlaceOption {
  value: string;
  label: string;
  address: string | null;
}

/**
 * Writing a promotional message: the text, an optional picture, place (one
 * of the venues) and link, who receives it, a preview of the message exactly
 * as it will arrive, and a confirmation that says how many people it goes to
 * before anything is sent. Without migration 0031 (`media` false) there is no
 * picture, place or link to add.
 */
export function CampaignComposer({
  audiences,
  places,
  sampleName,
  disabled,
  media,
}: {
  audiences: AudienceOption[];
  places: PlaceOption[];
  sampleName: string;
  disabled: boolean;
  media: boolean;
}) {
  const t = useTranslations("admin");
  const tc = useTranslations("common");
  const locale = useLocale();
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState("");
  const [place, setPlace] = useState("");
  const [link, setLink] = useState("");
  const [picture, setPicture] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const text = useRef<HTMLTextAreaElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const bodyId = useId();
  const audienceId = useId();
  const chosen = audiences.find((a) => a.value === audience) ?? audiences[0];
  const where = places.find((p) => p.value === place) ?? null;
  const cleanLink = /^https:\/\/\S+$/.test(link.trim()) ? link.trim() : null;
  const preview = body.trim() ? promoMessage({ id: "preview", body, name: sampleName, link: cleanLink }) : "";

  // The chosen picture is shown from the device itself; its address is let go when replaced.
  useEffect(() => () => {
    if (picture) URL.revokeObjectURL(picture);
  }, [picture]);
  const clearPicture = () => {
    if (file.current) file.current.value = "";
    setPicture(null);
  };

  return (
    <ActionForm
      action={startCampaignAction}
      onSuccess={() => {
        dialog.current?.close();
        setBody("");
        setPlace("");
        setLink("");
        clearPicture();
      }}
      // The reason shows under the form: the confirmation would cover it. What was written and chosen stays.
      onError={() => dialog.current?.close()}
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
      {media ? (
        <>
          <FormField name="image" label={t("promoImage")} hint={t("promoImageHint")}>
            {(a) => (
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  {...a}
                  ref={file}
                  type="file"
                  accept="image/jpeg,image/png"
                  className="max-w-xs"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    setPicture(f ? URL.createObjectURL(f) : null);
                  }}
                />
                {picture ? (
                  <Button variant="ghost" size="sm" onClick={clearPicture}>
                    <X aria-hidden="true" className="size-4" />
                    {t("promoImageRemove")}
                  </Button>
                ) : null}
              </div>
            )}
          </FormField>
          <FormField name="venue_id" label={t("promoPlace")} hint={t("promoPlaceHint")}>
            {(a) => (
              <Select {...a} value={place} onChange={(e) => setPlace(e.target.value)}>
                <option value="">{t("promoPlaceNone")}</option>
                {places.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
          <FormField name="link" label={t("promoLink")} hint={t("promoLinkHint")}>
            {(a) => (
              <Input
                {...a}
                type="url"
                inputMode="url"
                dir="ltr"
                placeholder="https://"
                pattern="https://\S+"
                maxLength={500}
                value={link}
                onChange={(e) => setLink(e.target.value)}
              />
            )}
          </FormField>
        </>
      ) : (
        <p className="text-xs text-muted">{t("promoMediaOld")}</p>
      )}
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
          <div data-testid="promo-preview" className="flex max-w-sm flex-col gap-1.5">
            <div className="overflow-hidden rounded-2xl rounded-ss-sm bg-[#d9fdd3] text-sm text-[#111b21] shadow-sm">
              {picture ? (
                // A local preview of the chosen file (a blob: address), not a stored picture.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={picture} alt={t("promoImageAlt")} className="max-h-64 w-full object-cover" />
              ) : null}
              <p className="whitespace-pre-wrap px-3 py-2">{preview}</p>
            </div>
            {where ? (
              <div className="flex items-start gap-2 rounded-2xl rounded-ss-sm bg-[#d9fdd3] px-3 py-2 text-sm text-[#111b21] shadow-sm">
                <MapPin aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[#d93025]" />
                <span>
                  <span className="block font-semibold">{where.label}</span>
                  {where.address ? <span className="block text-xs text-[#54656f]">{where.address}</span> : null}
                </span>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
      <Button
        type="button"
        className="self-start"
        disabled={disabled || chosen.count === 0}
        onClick={() => {
          if (text.current?.form?.reportValidity()) dialog.current?.showModal();
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
          {picture || where ? (
            <p className="flex flex-wrap gap-3 text-sm text-muted">
              {picture ? (
                <span className="inline-flex items-center gap-1">
                  <ImageIcon aria-hidden="true" className="size-4" />
                  {t("promoWithImage")}
                </span>
              ) : null}
              {where ? (
                <span className="inline-flex items-center gap-1">
                  <MapPin aria-hidden="true" className="size-4" />
                  {where.label}
                </span>
              ) : null}
            </p>
          ) : null}
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
