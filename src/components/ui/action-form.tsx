"use client";

import {
  createContext,
  useActionState,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import { useFormStatus } from "react-dom";
import { unstable_rethrow } from "next/navigation";
import { useTranslations } from "next-intl";
import { armCelebration } from "@/components/motion/celebrate";
import { bringIntoView, shake } from "@/components/motion/scroll";
import { BallSpinner } from "./ball-spinner";
import { Button, type ButtonProps } from "./button";
import { Alert } from "./primitives";
import { Field, controlProps, describedBy } from "./field";
import { cn } from "@/lib/cn";
import { fileBytes, shrinkFormImages, UPLOAD_LIMIT_BYTES } from "@/lib/shrink-image";
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
  onError,
  id,
  celebrate,
}: {
  action: FormAction;
  children: ReactNode;
  className?: string;
  successMessage?: string;
  resetOnSuccess?: boolean;
  hideSuccess?: boolean;
  onSuccess?: (data: unknown) => void;
  /** After a refusal, once what was submitted is back in the fields. */
  onError?: (error: string) => void;
  id?: string;
  /** Key of the <Celebration> that confirms this action's success (see components/motion/celebrate.tsx). */
  celebrate?: string;
}) {
  const [state, formAction] = useActionState(async (prev: ClientActionState, data: FormData): Promise<ClientActionState> => {
    // Pictures straight from a phone are made smaller first: the host refuses any request over 4.5 MB.
    const fd = await shrinkFormImages(data, { keepTransparency: true });
    // Whatever is still too big is stopped here with the reason, not refused on the way.
    if (fileBytes(fd) > UPLOAD_LIMIT_BYTES) return { ok: false, error: "file_too_large", at: Date.now() };
    try {
      return await action(prev, fd);
    } catch (error) {
      // The site's own redirects (and not-found) carry on as before.
      unstable_rethrow(error);
      // No answer from the site: the connection dropped, or the host refused the request. Said in the
      // form, with what was written kept, instead of the page breaking («حدث خطأ ما»).
      return { ok: false, error: "request_failed", at: Date.now() };
    }
  }, null);
  const formRef = useRef<HTMLFormElement>(null);
  const text = useErrorText();
  const t = useTranslations("common");
  const successText = useActionMessage();
  const lastHandled = useRef<number | null>(null);
  // What was submitted: React empties a form once its action has run (see restoreFields).
  const submitted = useRef<FormData | null>(null);

  useEffect(() => {
    if (!state || lastHandled.current === state.at) return;
    lastHandled.current = state.at;
    // After an error, keep what was typed: a wrong password mustn't wipe the e-mail, nor one mistake a whole form.
    if (!state.ok) {
      restoreFields(formRef.current, submitted.current);
      onError?.(state.error);
    }
    if (state.ok) {
      if (resetOnSuccess) formRef.current?.reset();
      onSuccess?.(state.data);
    } else if (state.fieldErrors) {
      const first = Object.keys(state.fieldErrors)[0];
      const field = formRef.current?.querySelector<HTMLElement>(`[name="${CSS.escape(first)}"]`);
      if (field) {
        field.focus({ preventScroll: true });
        bringIntoView(field);
        shake(field);
      }
    }
  }, [state, resetOnSuccess, onSuccess, onError]);

  const fieldErrors = state && !state.ok ? (state.fieldErrors ?? {}) : {};
  const translatedFieldErrors = Object.fromEntries(Object.entries(fieldErrors).map(([k, v]) => [k, text.field(v)]));

  return (
    <FieldErrorsContext.Provider value={translatedFieldErrors}>
      <form
        ref={formRef}
        action={formAction}
        onSubmit={(e) => {
          submitted.current = new FormData(e.currentTarget);
          if (celebrate) armCelebration(celebrate);
        }}
        className={cn("flex flex-col gap-4", className)}
        id={id}
        noValidate={false}
      >
        {children}
        <div aria-live="polite" aria-atomic="true">
          {/* Keyed by the response, so the same message sent again still pops (and an error shakes). */}
          {state && !state.ok ? (
            <Alert key={state.at} tone="danger" className="alert-pop">
              {state.fieldErrors && state.error === "validation" ? t("fixErrors") : text.error(state.error)}
            </Alert>
          ) : null}
          {state?.ok && !hideSuccess && (state.message || successMessage) ? (
            <Alert key={state.at} tone="success" className="alert-pop">
              {state.message ? successText(state.message) : successMessage}
            </Alert>
          ) : null}
        </div>
      </form>
    </FieldErrorsContext.Provider>
  );
}

/**
 * Puts back what was submitted. React 19 resets a form after its action runs,
 * whatever the answer, so without this an error would leave every field empty
 * (or back at its old value). Chosen files go back where the browser allows,
 * so sending again needs no new choice. Passwords stay empty; hidden fields
 * keep their own values.
 */
function restoreFields(form: HTMLFormElement | null, data: FormData | null) {
  if (!form || !data) return;
  const names = new Set(data.keys());
  for (const name of names) {
    const all = data.getAll(name);
    const values = all.filter((v): v is string => typeof v === "string");
    const files = all.filter((v): v is File => v instanceof File && v.size > 0);
    for (const el of form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`[name="${CSS.escape(name)}"]`)) {
      if (el instanceof HTMLInputElement) {
        if (el.type === "file") {
          if (files.length) restoreFiles(el, files);
          continue;
        }
        if (el.type === "password" || el.type === "hidden") continue;
        if (el.type === "checkbox" || el.type === "radio") el.checked = values.includes(el.value);
        else el.value = values[0] ?? "";
      } else if (el instanceof HTMLSelectElement) {
        if (el.multiple) for (const o of el.options) o.selected = values.includes(o.value);
        else if (values[0] !== undefined) el.value = values[0];
      } else {
        el.value = values[0] ?? "";
      }
    }
  }
  // A box that was unticked sends nothing: untick it again.
  for (const el of form.querySelectorAll<HTMLInputElement>('input[type="checkbox"][name]')) {
    if (!names.has(el.name)) el.checked = false;
  }
}

function restoreFiles(input: HTMLInputElement, files: File[]) {
  try {
    const list = new DataTransfer();
    for (const file of input.multiple ? files : files.slice(0, 1)) list.items.add(file);
    input.files = list.files;
  } catch {
    // A browser that can't set files: the person chooses again.
  }
}

export function useFieldError(name: string): string | undefined {
  return useContext(FieldErrorsContext)[name];
}

type FieldAria = ReturnType<typeof describedBy> & { id: string; name: string };

/**
 * Field wired to the surrounding ActionForm's errors. Client components pass a render function
 * to receive id/name/aria props. Server components cannot pass functions to a client component,
 * so they render the control with `{...controlProps(name)}`; the aria state is then applied to
 * that control after render.
 */
export function FormField({
  name,
  id: idOverride,
  label,
  hint,
  required,
  className,
  children,
}: {
  name: string;
  /** For a form that appears more than once on a page: its own control id (labels need unique ids). */
  id?: string;
  label: ReactNode;
  hint?: ReactNode;
  required?: boolean;
  className?: string;
  children: ((aria: FieldAria) => ReactNode) | ReactNode;
}) {
  const error = useFieldError(name);
  const id = idOverride ?? controlProps(name).id;
  const aria = describedBy(id, error, hint);
  const wrapper = useRef<HTMLDivElement>(null);
  const isRender = typeof children === "function";
  const describedby = aria["aria-describedby"];
  const invalid = aria["aria-invalid"];
  useEffect(() => {
    if (isRender) return;
    const el = wrapper.current?.querySelector<HTMLElement>(`#${CSS.escape(id)}`);
    if (!el) return;
    if (describedby) el.setAttribute("aria-describedby", describedby);
    else el.removeAttribute("aria-describedby");
    if (invalid) el.setAttribute("aria-invalid", "true");
    else el.removeAttribute("aria-invalid");
  }, [isRender, id, describedby, invalid]);
  return (
    <Field label={label} htmlFor={id} hint={hint} error={error} required={required} className={className}>
      {typeof children === "function" ? children({ id, name, ...aria }) : <div ref={wrapper} className="contents">{children}</div>}
    </Field>
  );
}

export function SubmitButton({ children, pendingLabel, ...props }: ButtonProps & { pendingLabel?: ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || props.disabled} aria-disabled={pending} {...props}>
      {pending ? <BallSpinner /> : null}
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
