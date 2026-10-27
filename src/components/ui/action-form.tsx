"use client";

import { createContext, useActionState, useContext, useEffect, useRef, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { Button, type ButtonProps } from "./button";
import { Alert } from "./primitives";
import { Field, describedBy } from "./field";
import { cn } from "@/lib/cn";
import { useActionMessage } from "./use-action-message";

type ClientActionState =
  | { ok: true; message?: string; data?: unknown; at: number }
  | { ok: false; error: string; fieldErrors?: Record<string, string>; at: number }
  | null;

export type FormAction = (prev: ClientActionState, formData: FormData) => Promise<ClientActionState>;

const FieldErrorsContext = createContext<Record<string, string>>({});

/** Translates an error code, falling back to a generic message. */
export function useErrorText() {
  const t = useTranslations("errors");
  const v = useTranslations("validation");
  return {
    error: (code: string) => (t.has(code) ? t(code) : t("generic")),
    field: (code: string) => (v.has(code) ? v(code) : t.has(code) ? t(code) : v("invalid")),
  };
}

export function ActionForm({
  action,
  children,
  className,
  successMessage,
  resetOnSuccess = false,
  hideSuccess = false,
  onSuccess,
  id,
}: {
  action: FormAction;
  children: ReactNode;
  className?: string;
  successMessage?: string;
  resetOnSuccess?: boolean;
  hideSuccess?: boolean;
  onSuccess?: (data: unknown) => void;
  id?: string;
}) {
  const [state, formAction] = useActionState(action, null);
  const formRef = useRef<HTMLFormElement>(null);
  const text = useErrorText();
  const t = useTranslations("common");
  const successText = useActionMessage();
  const lastHandled = useRef<number | null>(null);

  useEffect(() => {
    if (!state || lastHandled.current === state.at) return;
    lastHandled.current = state.at;
    if (state.ok) {
      if (resetOnSuccess) formRef.current?.reset();
      onSuccess?.(state.data);
    } else if (state.fieldErrors) {
      const first = Object.keys(state.fieldErrors)[0];
      formRef.current?.querySelector<HTMLElement>(`[name="${CSS.escape(first)}"]`)?.focus();
    }
  }, [state, resetOnSuccess, onSuccess]);

  const fieldErrors = state && !state.ok ? (state.fieldErrors ?? {}) : {};
  const translatedFieldErrors = Object.fromEntries(Object.entries(fieldErrors).map(([k, v]) => [k, text.field(v)]));

  return (
    <FieldErrorsContext.Provider value={translatedFieldErrors}>
      <form ref={formRef} action={formAction} className={cn("flex flex-col gap-4", className)} id={id} noValidate={false}>
        {children}
        <div aria-live="polite" aria-atomic="true">
          {state && !state.ok ? (
            <Alert tone="danger">{state.fieldErrors && state.error === "validation" ? t("fixErrors") : text.error(state.error)}</Alert>
          ) : null}
          {state?.ok && !hideSuccess && (state.message || successMessage) ? (
            <Alert tone="success">{state.message ? successText(state.message) : successMessage}</Alert>
          ) : null}
        </div>
      </form>
    </FieldErrorsContext.Provider>
  );
}

export function useFieldError(name: string): string | undefined {
  return useContext(FieldErrorsContext)[name];
}

/** Field wired to the surrounding ActionForm's errors. Pass a render function to receive aria props. */
export function FormField({
  name,
  label,
  hint,
  required,
  className,
  children,
}: {
  name: string;
  label: ReactNode;
  hint?: ReactNode;
  required?: boolean;
  className?: string;
  children: (aria: ReturnType<typeof describedBy> & { id: string; name: string }) => ReactNode;
}) {
  const error = useFieldError(name);
  const id = `f-${name}`;
  return (
    <Field label={label} htmlFor={id} hint={hint} error={error} required={required} className={className}>
      {children({ id, name, ...describedBy(id, error, hint) })}
    </Field>
  );
}

export function SubmitButton({ children, pendingLabel, ...props }: ButtonProps & { pendingLabel?: ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || props.disabled} aria-disabled={pending} {...props}>
      {pending ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
      {pending && pendingLabel ? pendingLabel : children}
    </Button>
  );
}

/** Hidden inputs from a record. */
export function Hidden({ values }: { values: Record<string, string | number | boolean | null | undefined> }) {
  return (
    <>
      {Object.entries(values).map(([k, v]) => (v == null ? null : <input key={k} type="hidden" name={k} value={String(v)} />))}
    </>
  );
}

/** Small inline action (single button) with feedback. */
export function InlineAction({
  action,
  values,
  label,
  variant = "secondary",
  size = "sm",
  successMessage,
  className,
}: {
  action: FormAction;
  values: Record<string, string | number | boolean | null | undefined>;
  label: ReactNode;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  successMessage?: string;
  className?: string;
}) {
  return (
    <ActionForm action={action} successMessage={successMessage} className={cn("gap-2", className)}>
      <Hidden values={values} />
      <SubmitButton variant={variant} size={size}>
        {label}
      </SubmitButton>
    </ActionForm>
  );
}
