"use client";

import { useEffect, useState } from "react";
import { Check, LoaderCircle, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";
import { isValidUsername, normalizeUsername, type UsernameStatus } from "@/lib/username";
import { checkUsername } from "@/server/username";
import { FormField } from "@/components/ui/action-form";

/**
 * The username, with «@» before it, typed left to right in lower case. As it
 * is typed, the field says whether it is free (asked a moment after the last
 * key). The server checks again when the form is sent.
 */
export function UsernameField({ defaultValue = "", required = true }: { defaultValue?: string; required?: boolean }) {
  const t = useTranslations("auth");
  const [value, setValue] = useState(defaultValue);
  // The server's answer, for the name it was about.
  const [answer, setAnswer] = useState<{ name: string; status: UsernameStatus } | null>(null);
  const name = normalizeUsername(value);
  const needsAsking = Boolean(name) && name !== defaultValue && isValidUsername(name);
  const status: UsernameStatus | "checking" | null =
    !name || name === defaultValue
      ? null
      : !isValidUsername(name)
        ? "invalid"
        : answer?.name === name
          ? answer.status === "unknown"
            ? null
            : answer.status
          : "checking";

  useEffect(() => {
    if (!needsAsking) return;
    let current = true;
    const timer = window.setTimeout(async () => {
      const result = await checkUsername(name).catch(() => "unknown" as const);
      if (current) setAnswer({ name, status: result });
    }, 400);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [name, needsAsking]);

  const note =
    status === "ok" ? t("usernameFree") : status === "taken" ? t("usernameTaken") : status === "invalid" ? t("usernameInvalid") : status === "checking" ? t("usernameChecking") : null;
  return (
    <FormField name="username" label={t("username")} hint={t("usernameHint")} required={required}>
      {(a) => (
        <div className="flex flex-col gap-1.5">
          <div dir="ltr" className="flex items-stretch overflow-hidden rounded-xl border border-line bg-surface focus-within:border-accent">
            <span aria-hidden="true" className="grid place-items-center ps-3 text-muted">@</span>
            <input
              {...a}
              type="text"
              value={value}
              onChange={(e) => setValue(normalizeUsername(e.target.value))}
              required={required}
              minLength={3}
              maxLength={20}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              autoComplete="off"
              inputMode="text"
              className="min-w-0 flex-1 bg-transparent px-2 py-2.5 text-base outline-none"
            />
          </div>
          {note ? (
            <p aria-live="polite" className={cn("flex items-center gap-1.5 text-xs", status === "ok" ? "text-success" : status === "checking" ? "text-muted" : "text-danger")}>
              {status === "ok" ? <Check aria-hidden="true" className="size-3.5" /> : status === "checking" ? <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" /> : <X aria-hidden="true" className="size-3.5" />}
              {note}
            </p>
          ) : null}
        </div>
      )}
    </FormField>
  );
}
