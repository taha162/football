"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { CheckCircle2, Copy, Loader2, MessageCircle } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { buttonClass } from "@/components/ui/button";
import { Alert } from "@/components/ui/primitives";
import { pollWhatsappAction, type WhatsappPoll } from "@/server/whatsapp";

const POLL_MS = 3000;

/** Shows the code to send and waits for the webhook to confirm it. */
export function WhatsappWaiter({
  code,
  number,
  link,
  expiresAt,
  purpose,
}: {
  code: string;
  number: string;
  link: string;
  expiresAt: string;
  purpose: "signup" | "reset";
}) {
  const t = useTranslations("auth");
  const [state, setState] = useState<WhatsappPoll["state"]>("pending");
  const [copied, setCopied] = useState(false);
  const [minutesLeft, setMinutesLeft] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    const tick = async () => {
      const result = await pollWhatsappAction();
      if (!active) return;
      if (result.state === "done") {
        setState("done");
        window.location.assign(result.href);
        return;
      }
      setState(result.state);
      if (result.state === "pending") timer = setTimeout(tick, POLL_MS);
    };
    let timer = setTimeout(tick, POLL_MS);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    const update = () => setMinutesLeft(Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 60_000)));
    const id = setInterval(update, 15_000);
    const first = setTimeout(update, 0);
    return () => {
      clearInterval(id);
      clearTimeout(first);
    };
  }, [expiresAt]);

  const restart = purpose === "signup" ? "/sign-up?method=whatsapp" : "/forgot-password";

  if (state === "done") {
    return (
      <Alert tone="success" title={t("waVerified")}>
        <Loader2 aria-hidden="true" className="inline size-4 animate-spin" />
      </Alert>
    );
  }
  if (state === "expired" || state === "missing") {
    return (
      <Alert tone="warning" title={t("waExpired")}>
        <Link href={restart} className="text-accent underline">{t("waRestart")}</Link>
      </Alert>
    );
  }
  if (state === "phone_taken" || state === "no_account") {
    return (
      <Alert tone="warning" title={state === "phone_taken" ? t("waPhoneTaken") : t("waNoAccount")}>
        <Link href={state === "phone_taken" ? "/sign-in" : "/sign-up?method=whatsapp"} className="text-accent underline">
          {state === "phone_taken" ? t("signIn") : t("createAccount")}
        </Link>
      </Alert>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <ol className="flex flex-col gap-2 text-sm text-muted">
        <li>1. {t("waStep1")}</li>
        <li>2. {t("waStep2")}</li>
        <li>3. {t("waStep3")}</li>
      </ol>
      <div className="flex flex-col items-center gap-2 rounded-2xl border border-line bg-surface-2 p-5">
        <span className="text-xs text-muted">{t("waYourCode")}</span>
        <span className="num font-display text-4xl font-extrabold tracking-[0.2em] text-accent" dir="ltr" data-testid="wa-code">
          {code}
        </span>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(code).then(() => setCopied(true));
          }}
          className={buttonClass("ghost", "sm")}
        >
          {copied ? <CheckCircle2 aria-hidden="true" className="size-4" /> : <Copy aria-hidden="true" className="size-4" />}
          {copied ? t("waCopied") : t("waCopy")}
        </button>
      </div>
      <a href={link} target="_blank" rel="noopener noreferrer" className={buttonClass("primary", "lg", "w-full")}>
        <MessageCircle aria-hidden="true" className="size-5" />
        {t("waOpen")}
      </a>
      <p className="text-center text-xs text-muted">
        {t("waSendTo")} <span className="num font-semibold text-ink" dir="ltr">+{number}</span>
      </p>
      <div role="status" aria-live="polite" className="flex items-center justify-center gap-2 text-sm text-muted">
        <Loader2 aria-hidden="true" className="size-4 animate-spin" />
        {t("waWaiting")}
        {minutesLeft !== null ? <span>· {t("waExpires", { minutes: minutesLeft })}</span> : null}
      </div>
    </div>
  );
}
