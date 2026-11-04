"use client";

import { useId, useRef, useState } from "react";
import { MoreHorizontal, Pencil, Trash2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { deleteMessage } from "@/server/messages";

/**
 * «⋯» beside the sender's own message opens a small sheet: «تعديل» (when it
 * has text) and «حذف». Deleting asks first; everyone then sees «رسالة محذوفة»
 * in its place. A dialog, so the scrolling message list can't clip it.
 */
export function MessageMenu({ messageId, canEdit, onEdit, onDeleted }: { messageId: number; canEdit: boolean; onEdit: () => void; onDeleted: () => void }) {
  const t = useTranslations("messages");
  const errors = useTranslations("errors");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  const open = () => {
    setConfirming(false);
    setError(null);
    dialog.current?.showModal();
  };
  const close = () => dialog.current?.close();

  const remove = async () => {
    setBusy(true);
    setError(null);
    const res = await deleteMessage(messageId);
    setBusy(false);
    if (!res.ok) {
      setError(errors.has(res.error) ? errors(res.error) : errors("generic"));
      return;
    }
    close();
    onDeleted();
  };

  return (
    <>
      <button
        type="button"
        onClick={open}
        aria-label={t("options")}
        aria-haspopup="dialog"
        className="flex size-7 items-center justify-center rounded-full text-faint hover:bg-surface-2 hover:text-ink"
      >
        <MoreHorizontal aria-hidden="true" className="size-4" />
      </button>
      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        // A tap on the backdrop closes it.
        onClick={(e) => {
          if (e.target === e.currentTarget) close();
        }}
        className="m-auto w-[min(92vw,22rem)] rounded-2xl border border-line bg-surface p-0 text-ink shadow-2xl"
      >
        <div className="flex flex-col gap-3 p-5">
          <div className="flex items-start justify-between gap-3">
            <h2 id={titleId} className="font-display text-lg font-semibold">{confirming ? t("deleteTitle") : t("options")}</h2>
            <Button variant="ghost" size="sm" onClick={close} aria-label={t("cancel")}>
              <X aria-hidden="true" className="size-4" />
            </Button>
          </div>
          {confirming ? (
            <>
              <p className="text-sm text-muted">{t("deleteBody")}</p>
              {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={close}>{t("cancel")}</Button>
                <Button variant="danger" onClick={remove} disabled={busy}>{t("delete")}</Button>
              </div>
            </>
          ) : (
            <div className="flex flex-col gap-2">
              {canEdit ? (
                <Button
                  variant="outline"
                  className="justify-start"
                  onClick={() => {
                    close();
                    onEdit();
                  }}
                >
                  <Pencil aria-hidden="true" className="size-4" />
                  {t("edit")}
                </Button>
              ) : null}
              <Button variant="outline" className="justify-start text-danger" onClick={() => setConfirming(true)}>
                <Trash2 aria-hidden="true" className="size-4" />
                {t("delete")}
              </Button>
            </div>
          )}
        </div>
      </dialog>
    </>
  );
}
