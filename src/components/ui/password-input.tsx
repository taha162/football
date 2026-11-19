"use client";

import { useState, type ComponentProps } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/cn";
import { Input } from "./field";

/**
 * A password field with an eye button that shows what was typed, and hides it
 * again. The button sits at the field's end (the left in Arabic); the password
 * itself stays left to right, never corrected or capitalised while shown.
 * `data-secret`: after a refused send the password is not put back, even
 * while shown (restoreFields in action-form.tsx).
 */
export function PasswordInput({ className, ...props }: Omit<ComponentProps<typeof Input>, "type">) {
  const t = useTranslations("auth");
  const rtl = useLocale() === "ar";
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <Input
        {...props}
        type={shown ? "text" : "password"}
        dir="ltr"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        data-secret=""
        className={cn(rtl ? "pl-12" : "pr-12", className)}
      />
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        aria-label={t("showPassword")}
        aria-pressed={shown}
        aria-controls={props.id}
        title={t("showPassword")}
        className="absolute inset-y-0 end-0 flex w-11 items-center justify-center rounded-e-xl text-muted transition-colors hover:text-ink focus-visible:text-ink focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
      >
        {shown ? <EyeOff aria-hidden="true" className="size-[18px]" /> : <Eye aria-hidden="true" className="size-[18px]" />}
      </button>
    </div>
  );
}
