"use client";

import { useId, useRef } from "react";
import { useTranslations } from "next-intl";
import { Flag, X } from "lucide-react";
import { ActionForm, FormField, Hidden, SubmitButton } from "@/components/ui/action-form";
import { Button } from "@/components/ui/button";
import { Select, Textarea } from "@/components/ui/field";
import { createReportAction } from "@/server/reports";

const CATEGORIES = ["spam", "harassment", "fake_listing", "fraudulent_booking", "inappropriate_content", "unsafe_behavior", "other"] as const;

export function ReportButton({ targetType, targetId, compact }: { targetType: string; targetId: string; compact?: boolean }) {
  const t = useTranslations("report");
  const c = useTranslations("common");
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => ref.current?.showModal()} aria-haspopup="dialog" aria-label={compact ? t("open") : undefined}>
        <Flag aria-hidden="true" className="size-4" />
        {compact ? null : t("open")}
      </Button>
      <dialog ref={ref} aria-labelledby={titleId} className="m-auto w-[min(92vw,28rem)] rounded-2xl border border-line bg-surface p-0 text-ink shadow-2xl">
        <div className="flex flex-col gap-4 p-5">
          <div className="flex items-start justify-between gap-3">
            <h2 id={titleId} className="font-display text-lg font-semibold">{t("title")}</h2>
            <Button variant="ghost" size="sm" onClick={() => ref.current?.close()} aria-label={c("close")}>
              <X aria-hidden="true" className="size-4" />
            </Button>
          </div>
          <p className="text-sm text-muted">{t("description")}</p>
          <ActionForm action={createReportAction}>
            <Hidden values={{ target_type: targetType, target_id: targetId }} />
            <FormField name="category" label={t("category")} required>
              {(a) => (
                <Select {...a} required defaultValue="">
                  <option value="" disabled>{t("choose")}</option>
                  {CATEGORIES.map((k) => (
                    <option key={k} value={k}>{t(`categories.${k}`)}</option>
                  ))}
                </Select>
              )}
            </FormField>
            <FormField name="details" label={t("details")}>
              {(a) => <Textarea {...a} maxLength={1000} />}
            </FormField>
            <SubmitButton variant="danger">{t("submit")}</SubmitButton>
          </ActionForm>
        </div>
      </dialog>
    </>
  );
}
