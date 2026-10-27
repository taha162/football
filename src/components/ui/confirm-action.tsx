"use client";

import { useId, useRef, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";
import { ActionForm, Hidden, SubmitButton, type FormAction } from "./action-form";
import { Button, type ButtonProps } from "./button";
import { Field, Textarea } from "./field";

/**
 * A button that opens an accessible modal (<dialog>) asking for confirmation,
 * optionally with a reason field, before submitting a server action.
 */
export function ConfirmAction({
  action,
  values,
  label,
  title,
  description,
  confirmLabel,
  variant = "danger",
  size = "sm",
  reasonName,
  reasonLabel,
  reasonRequired,
  successMessage,
}: {
  action: FormAction;
  values: Record<string, string | number | boolean | null | undefined>;
  label: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel: ReactNode;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  reasonName?: string;
  reasonLabel?: ReactNode;
  reasonRequired?: boolean;
  successMessage?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();
  const reasonId = useId();
  const t = useTranslations("common");
  return (
    <>
      <Button variant={variant} size={size} onClick={() => ref.current?.showModal()} aria-haspopup="dialog">
        {label}
      </Button>
      <dialog
        ref={ref}
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        className="m-auto w-[min(92vw,28rem)] rounded-2xl border border-line bg-surface p-0 text-ink shadow-2xl"
      >
        <div className="flex flex-col gap-4 p-5">
          <div className="flex items-start justify-between gap-3">
            <h2 id={titleId} className="font-display text-lg font-semibold">
              {title}
            </h2>
            <Button variant="ghost" size="sm" onClick={() => ref.current?.close()} aria-label={t("close")}>
              <X aria-hidden="true" className="size-4" />
            </Button>
          </div>
          {description ? (
            <p id={descId} className="text-sm text-muted">
              {description}
            </p>
          ) : null}
          <ActionForm action={action} successMessage={successMessage} onSuccess={() => ref.current?.close()}>
            <Hidden values={values} />
            {reasonName ? (
              <Field label={reasonLabel} htmlFor={reasonId} required={reasonRequired}>
                <Textarea id={reasonId} name={reasonName} required={reasonRequired} minLength={reasonRequired ? 3 : undefined} maxLength={500} />
              </Field>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => ref.current?.close()}>
                {t("cancel")}
              </Button>
              <SubmitButton variant={variant === "primary" ? "primary" : "danger"}>{confirmLabel}</SubmitButton>
            </div>
          </ActionForm>
        </div>
      </dialog>
    </>
  );
}

export type { FormAction };
