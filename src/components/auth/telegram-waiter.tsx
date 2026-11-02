"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { CheckCircle2, Copy, Loader2, Send } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { buttonClass } from "@/components/ui/button";
import { Alert } from "@/components/ui/primitives";
import { pollTelegramAction, type TelegramPoll } from "@/server/telegram";
import { ExternalLinkButton } from "@/components/ui/link-button";
import { MoreOptions } from "@/components/ui/more-options";

const POLL_MS = 3000;

/** Sends the user to the bot and waits until it has verified their number. */
export function TelegramWaiter({
  code,
  bot,
  link,
  expiresAt,
  purpose,
  linked: linkedAtLoad,
}: {
  code: string;
  bot: string;
  link: string;
  expiresAt: string;
  purpose: "signup" | "reset";
  linked: boolean;
}) {
  const t = useTranslations("auth");
  const [state, setState] = useState<TelegramPoll["state"]>("pending");
  const [linked, setLinked] = useState(linkedAtLoad);
  const [copied, setCopied] = useState(false);
  const [minutesLeft, setMinutesLeft] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    const tick = async () => {
      const result = await pollTelegramAction();
      if (!active) return;
      if (result.state === "done") {
        setState("done");
        window.location.assign(result.href);
        return;
      }
      setState(result.state);
      if (result.state === "pending") {
        setLinked(result.linked);
        timer = setTimeout(tick, POLL_MS);
      }
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

  const restart = purpose === "signup" ? "/sign-up?method=telegram" : "/forgot-password";

  if (state === "done") {
    return (
      <Alert tone="success" title={t("tgVerified")}>
        <Loader2 aria-hidden="true" className="inline size-4 animate-spin" />
      </Alert>
    );
  }
  if (state === "expired" || state === "missing") {
    return (
      <Alert tone="warning" title={t("tgExpired")}>
        <Link href={restart} className="text-accent underline">{t("tgRestart")}</Link>
      </Alert>
    );
  }
  if (state === "phone_taken" || state === "no_account") {
    return (
      <Alert tone="warning" title={state === "phone_taken" ? t("tgPhoneTaken") : t("tgNoAccount")}>
        <Link href={state === "phone_taken" ? "/sign-in" : "/sign-up?method=telegram"} className="text-accent underline">
          {state === "phone_taken" ? t("signIn") : t("createAccount")}
        </Link>
      </Alert>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <ol className="flex flex-col gap-2 text-sm text-muted">
        <li>1. {t("tgStep1")}</li>
        <li>2. {t("tgStep2")}</li>
      </ol>
      <ExternalLinkButton href={link} className={buttonClass("primary", "lg", "w-full")}>
        <Send aria-hidden="true" className="size-5 rtl:-scale-x-100" />
        {t("tgOpen")}
      </ExternalLinkButton>
      {linked ? (
        <Alert tone="info" title={t("tgLinked")} />
      ) : null}
      {/* The fallback (typing the code to the bot) is folded: the button is enough for most people. */}
      <MoreOptions label={t("tgNoBot")}>
      <div className="flex flex-col items-center gap-2">
        <span className="text-center text-xs text-muted">
          {t("tgManual")} <span className="font-semibold text-ink" dir="ltr">@{bot}</span>
        </span>
        <span className="num font-display text-3xl font-extrabold tracking-[0.2em] text-accent" dir="ltr" data-testid="verify-code">
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
          {copied ? t("tgCopied") : t("tgCopy")}
        </button>
      </div>
      </MoreOptions>
      <div role="status" aria-live="polite" className="flex items-center justify-center gap-2 text-sm text-muted">
        <Loader2 aria-hidden="true" className="size-4 animate-spin" />
        {t("tgWaiting")}
        {minutesLeft !== null ? <span>· {t("tgExpires", { minutes: minutesLeft })}</span> : null}
      </div>
    </div>
  );
}
