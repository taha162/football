import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

// `field-control` (globals.css): eased colours and the soft focus glow.
const control =
  "field-control w-full rounded-xl border border-line bg-surface-2 px-3.5 text-ink placeholder:text-faint hover:border-line-strong focus:border-accent focus:outline-none focus-visible:outline-none aria-[invalid=true]:border-danger disabled:opacity-60";

export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
  className,
  required,
}: {
  label: ReactNode;
  htmlFor: string;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  className?: string;
  required?: boolean;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={htmlFor} className="text-sm font-medium text-ink">
        {label}
        {required ? <span aria-hidden="true" className="text-accent"> *</span> : null}
      </label>
      {children}
      {hint && !error ? (
        <p id={`${htmlFor}-hint`} className="text-xs text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${htmlFor}-error`} className="text-xs font-medium text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** id/name for a control inside a FormField; usable from server components. */
export function controlProps(name: string) {
  return { id: `f-${name}`, name };
}

/** aria props tying a control to its Field hint/error. */
export function describedBy(id: string, error?: unknown, hint?: unknown) {
  const ids = [error ? `${id}-error` : null, hint && !error ? `${id}-hint` : null].filter(Boolean).join(" ");
  return { "aria-describedby": ids || undefined, "aria-invalid": error ? true : undefined } as const;
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(control, "h-11", className)} {...props} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(control, "min-h-24 py-2.5", className)} {...props} />;
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(control, "h-11 appearance-none bg-[length:12px] pe-9", className)} {...props}>
      {children}
    </select>
  );
}

export function Checkbox({
  label,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }) {
  return (
    <label className={cn("flex min-h-11 cursor-pointer items-center gap-3 text-sm text-ink", className)}>
      <input type="checkbox" className="size-5 shrink-0 rounded accent-[var(--color-accent)]" {...props} />
      <span>{label}</span>
    </label>
  );
}

/** Pill-style multi/single choice using native checkboxes/radios. */
export function ChoiceChips({
  name,
  type = "checkbox",
  options,
  defaultValue,
  legend,
}: {
  name: string;
  type?: "checkbox" | "radio";
  options: { value: string; label: ReactNode }[];
  defaultValue?: string[] | string | null;
  legend: ReactNode;
}) {
  const selected = new Set(Array.isArray(defaultValue) ? defaultValue : defaultValue ? [defaultValue] : []);
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1.5 text-sm font-medium text-ink">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <label key={o.value} className="cursor-pointer">
            <input type={type} name={name} value={o.value} defaultChecked={selected.has(o.value)} className="peer sr-only" />
            <span className="chip inline-flex min-h-10 items-center rounded-full border border-line bg-surface-2 px-4 text-sm text-muted hover:border-line-strong peer-checked:border-accent peer-checked:bg-accent/10 peer-checked:text-accent peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-accent">
              {o.label}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
