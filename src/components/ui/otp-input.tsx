"use client";

import { Fragment, useEffect, useRef, useState, type ComponentProps } from "react";
import { cn } from "@/lib/cn";

/** Arabic-Indic (٠–٩) and Persian (۰–۹) digits as 0–9: a code typed on an Arabic keyboard works too. */
export function asciiDigits(value: string): string {
  return value.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x6f0));
}

/** The digits of what was typed or pasted ("123 456", "123-456", "١٢٣٤٥٦" all give 123456), at most `max`. */
export function codeDigits(value: string, max: number): string {
  return asciiDigits(value).replace(/\D/g, "").slice(0, max);
}

/**
 * A one-time code as a row of boxes, one digit each, read left to right.
 * Underneath is one real field (autocomplete="one-time-code"): the phone can
 * fill it from a message, a pasted code lands whole, screen readers hear one
 * labelled field, and the form sends it as before. The caret stays at the end;
 * Backspace takes the last digit.
 *
 * `length` boxes at first; a longer code (up to `maxLength`) adds boxes as it
 * comes, for e-mailed codes whose length is set in Supabase (6 to 10). A
 * code is never put back after a refused send (data-secret): the boxes
 * empty, and the field is ready for the next one.
 */
export function OtpInput({
  length = 6,
  maxLength = length,
  className,
  onFocus,
  onBlur,
  ...props
}: Omit<ComponentProps<"input">, "type" | "value" | "defaultValue" | "onChange" | "maxLength" | "pattern"> & { length?: number; maxLength?: number }) {
  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const invalid = props["aria-invalid"] === true || props["aria-invalid"] === "true";

  // React empties a form once its action has run: the boxes empty with it, ready for a new code.
  useEffect(() => {
    const input = ref.current;
    const form = input?.form;
    if (!input || !form) return;
    const onReset = () => {
      setValue("");
      requestAnimationFrame(() => {
        if (input.isConnected && document.activeElement !== input) input.focus({ preventScroll: true });
      });
    };
    form.addEventListener("reset", onReset);
    return () => form.removeEventListener("reset", onReset);
  }, []);

  const toEnd = (el: HTMLInputElement) => {
    const end = el.value.length;
    if (el.selectionStart !== end || el.selectionEnd !== end) el.setSelectionRange(end, end);
  };

  const boxes = Math.min(maxLength, Math.max(length, value.length));
  const active = focused ? Math.min(value.length, boxes - 1) : -1;
  // Six boxes read as two threes (and eight as two fours), with a dash between.
  const split = boxes >= 6 && boxes % 2 === 0 ? boxes / 2 : -1;

  return (
    <div className={cn("relative", className)}>
      <div dir="ltr" aria-hidden="true" className="flex items-center justify-center gap-1.5 sm:gap-2">
        {Array.from({ length: boxes }, (_, i) => (
          <Fragment key={i}>
            {i === split ? <span className="h-0.5 w-2.5 shrink-0 rounded-full bg-line-strong sm:w-3" /> : null}
            <span
              data-otp-box=""
              className={cn(
                "num grid aspect-square min-w-0 max-w-12 flex-1 place-items-center rounded-xl border bg-surface-2 text-xl font-semibold text-ink transition-[border-color,box-shadow] duration-150",
                i === active
                  ? "border-accent shadow-[0_0_0_3px_color-mix(in_oklab,var(--color-accent)_25%,transparent)]"
                  : invalid
                    ? "border-danger"
                    : value[i]
                      ? "border-line-strong"
                      : "border-line",
              )}
            >
              {value[i] ?? (i === active ? <span className="otp-caret h-5 w-0.5 rounded-full bg-accent" /> : null)}
            </span>
          </Fragment>
        ))}
      </div>
      <input
        ref={ref}
        {...props}
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        autoCorrect="off"
        spellCheck={false}
        dir="ltr"
        data-secret=""
        pattern={`[0-9]{${length},${maxLength}}`}
        value={value}
        onChange={(e) => setValue(codeDigits(e.target.value, maxLength))}
        onFocus={(e) => {
          setFocused(true);
          toEnd(e.currentTarget);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        onSelect={(e) => toEnd(e.currentTarget)}
        className="absolute inset-0 size-full cursor-text rounded-xl text-transparent opacity-0 [caret-color:transparent]"
      />
    </div>
  );
}
