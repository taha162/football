"use client";

import { useRef, useState } from "react";
import { ImagePlus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { ActionForm, Hidden, SubmitButton } from "@/components/ui/action-form";
import { Textarea } from "@/components/ui/field";
import { sendMessageAction } from "@/server/messages";

const MAX_SIDE = 1600;

/**
 * Phone photos are often several megabytes: shrink to at most 1600 px on the
 * long side as JPEG before sending (faster on mobile data, and under the 5 MB
 * limit). Falls back to the original file if the browser can't decode it.
 */
async function shrink(file: File): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 1_500_000 && file.type === "image/jpeg") return file;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
    return blob ? new File([blob], "photo.jpg", { type: "image/jpeg" }) : file;
  } catch {
    return file;
  }
}

/** Text and/or one picture. The picture is previewed, and can be removed before sending. */
export function Composer({ conversationId }: { conversationId: string }) {
  const t = useTranslations("messages");
  const fileInput = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const clear = () => {
    if (fileInput.current) fileInput.current.value = "";
    setPreview((old) => {
      if (old) URL.revokeObjectURL(old);
      return null;
    });
  };

  const tool = "flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-line text-muted transition-colors hover:text-ink";
  return (
    <ActionForm action={sendMessageAction} resetOnSuccess hideSuccess onSuccess={clear} className="gap-2">
      <Hidden values={{ conversation_id: conversationId }} />
      {preview ? (
        <div className="relative w-fit">
          {/* eslint-disable-next-line @next/next/no-img-element -- local preview of the chosen file */}
          <img src={preview} alt="" className="max-h-40 rounded-xl border border-line" />
          <button type="button" onClick={clear} aria-label={t("removeImage")} className="absolute -top-2 -end-2 flex size-7 items-center justify-center rounded-full bg-surface-3 text-ink shadow">
            <X aria-hidden="true" className="size-4" />
          </button>
        </div>
      ) : null}
      <label htmlFor="message-body" className="sr-only">{t("write")}</label>
      <Textarea id="message-body" name="body" required={!preview} maxLength={2000} placeholder={t("placeholder")} className="min-h-20" dir="auto" />
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <label className={tool} title={t("attach")}>
            <ImagePlus aria-hidden="true" className="size-5" />
            <span className="sr-only">{t("attach")}</span>
            <input
              ref={fileInput}
              type="file"
              name="image"
              accept="image/jpeg,image/png,image/webp,image/*"
              className="sr-only"
              onChange={async (e) => {
                const input = e.currentTarget;
                const chosen = input.files?.[0];
                if (!chosen) return clear();
                const small = await shrink(chosen);
                if (small !== chosen) {
                  const list = new DataTransfer();
                  list.items.add(small);
                  input.files = list.files;
                }
                setPreview((old) => {
                  if (old) URL.revokeObjectURL(old);
                  return URL.createObjectURL(small);
                });
              }}
            />
          </label>
        </div>
        <SubmitButton>{t("send")}</SubmitButton>
      </div>
    </ActionForm>
  );
}
