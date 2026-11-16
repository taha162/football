"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { CheckCircle2, Copy, Loader2, MessageCircle } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { buttonClass } from "@/components/ui/button";
import { Alert } from "@/components/ui/primitives";
import { ExternalLinkButton } from "@/components/ui/link-button";
import { MoreOptions } from "@/components/ui/more-options";
import { pollWhatsappAction, type VerificationPoll } from "@/server/whatsapp";

const POLL_MS = 2000;
const HIDDEN_POLL_MS = 15_000;
/** WhatsApp was opened by itself for this code already: a reload or coming back doesn't open it again. */
const openedKey = (code: string) => `malaab-wa-opened:${code}`;
/** Codes it was opened for in this page view (React may run an effect twice while developing). */
const openedHere = new Set<string>();

/**
 * Opens WhatsApp on the platform's number with the code typed in, and waits
 * until the bot has received it. `from` is the number the user typed: the
 * code counts only from that number's WhatsApp.
 *
 * WhatsApp opens by itself right after the form: the tap that sent it still
 * counts as the user's own action for a few seconds, and browsers let a page
 * open another site only then. Where that isn't so (an older browser, a
 * reload), nothing opens and the button does it. WhatsApp itself never lets a
 * site press "send": the user does.
 *
 * The page asks every 2 seconds while it is on screen. On a phone it is in
 * the background while the user is in WhatsApp: it then asks only now and
 * then, and again the moment it is back, so it carries on as soon as the user
 * returns. A failed request (common right after switching apps) is simply
 * asked again.
 */
export function WhatsappWaiter({
  code,
  from = null,
  number,
  link,
  expiresAt,
  purpose,
}: {
  code: string;
  from?: string | null;
  number: string;
  link: string;
  expiresAt: string;
  purpose: "signup" | "reset";
}) {
  const t = useTranslations("auth");
  const [state, setState] = useState<VerificationPoll["state"]>("pending");
  const [copied, setCopied] = useState<"code" | "number" | null>(null);
  const [minutesLeft, setMinutesLeft] = useState<number | null>(null);
  const [autoOpened, setAutoOpened] = useState(false);

  useEffect(() => {
    const say = () => {
      const shown = setTimeout(() => setAutoOpened(true), 0);
      return () => clearTimeout(shown);
    };
    if (openedHere.has(code)) return say();
    let before = false;
    try {
      before = sessionStorage.getItem(openedKey(code)) === "1";
    } catch {
      // Storage refused (private mode): opened at most once anyway, while the tap still counts.
    }
    // Without the user's tap still in effect the browser would block it (and say so): the button is there.
    if (before || !navigator.userActivation?.isActive) return;
    try {
      sessionStorage.setItem(openedKey(code), "1");
    } catch {
      /* see above */
    }
    openedHere.add(code);
    window.open(link, "_blank", "noopener,noreferrer");
    return say();
  }, [code, link]);

  useEffect(() => {
    let active = true;
    let asking = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const visible = () => document.visibilityState === "visible";
    const later = () => {
      clearTimeout(timer);
      if (active) timer = setTimeout(ask, visible() ? POLL_MS : HIDDEN_POLL_MS);
    };
    async function ask() {
      // Server actions go one at a time: a second request would only queue behind this one.
      if (!active || asking) return;
      asking = true;
      let result: VerificationPoll | null = null;
      try {
        result = await pollWhatsappAction();
      } catch {
        // No answer (the connection dropped while the page was hidden): ask again.
      }
      asking = false;
      if (!active) return;
      if (result?.state === "done") {
        active = false;
        setState("done");
        window.location.assign(result.href);
        return;
      }
      if (result) setState(result.state);
      if (!result || result.state === "pending") later();
    }
    // Back on screen: ask at once. Gone to the background: ask only now and then.
    const back = () => {
      if (!visible()) return later();
      clearTimeout(timer);
      void ask();
    };
    document.addEventListener("visibilitychange", back);
    window.addEventListener("focus", back);
    window.addEventListener("pageshow", back);
    later();
    return () => {
      active = false;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", back);
      window.removeEventListener("focus", back);
      window.removeEventListener("pageshow", back);
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

  const copy = (what: "code" | "number") => {
    void navigator.clipboard?.writeText(what === "code" ? code : number.replace(/\s/g, "")).then(() => setCopied(what));
  };
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
      {from ? (
        <p className="rounded-xl border border-line bg-surface-2 px-4 py-3 text-center text-sm" data-testid="whatsapp-from">
          {t.rich("waFrom", {
            phone: from,
            num: (c) => (
              <span className="font-semibold whitespace-nowrap text-ink" dir="ltr">
                {c}
              </span>
            ),
          })}{" "}
          <Link href={restart} className="whitespace-nowrap text-accent underline">
            {t("waNotMyNumber")}
          </Link>
        </p>
      ) : null}
      {autoOpened ? <Alert tone="info">{t("waAutoOpened")}</Alert> : null}
      <ol className="flex flex-col gap-2 text-sm text-muted">
        <li>1. {t("waStep1")}</li>
        <li>2. {t("waStep2")}</li>
      </ol>
      <ExternalLinkButton href={link} className={buttonClass("primary", "lg", "w-full")}>
        <MessageCircle aria-hidden="true" className="size-5" />
        {t("waOpen")}
      </ExternalLinkButton>
      {/* By hand, for a phone where the button doesn't open WhatsApp (or WhatsApp on another device). */}
      <MoreOptions label={t("waNoApp")}>
        <div className="flex flex-col items-center gap-2">
          <span className="text-center text-xs text-muted">{t("waManual")}</span>
          <span className="font-semibold text-ink" dir="ltr" data-testid="whatsapp-number">{number}</span>
          <button type="button" onClick={() => copy("number")} className={buttonClass("ghost", "sm")}>
            {copied === "number" ? <CheckCircle2 aria-hidden="true" className="size-4" /> : <Copy aria-hidden="true" className="size-4" />}
            {copied === "number" ? t("waCopied") : t("waCopyNumber")}
          </button>
          <span className="num font-display text-3xl font-extrabold tracking-[0.2em] text-accent" dir="ltr" data-testid="verify-code">
            {code}
          </span>
          <button type="button" onClick={() => copy("code")} className={buttonClass("ghost", "sm")}>
            {copied === "code" ? <CheckCircle2 aria-hidden="true" className="size-4" /> : <Copy aria-hidden="true" className="size-4" />}
            {copied === "code" ? t("waCopied") : t("waCopyCode")}
          </button>
        </div>
      </MoreOptions>
      <div role="status" aria-live="polite" className="flex items-center justify-center gap-2 text-sm text-muted">
        <Loader2 aria-hidden="true" className="size-4 animate-spin" />
        {t("waWaiting")}
        {minutesLeft !== null ? <span>· {t("waExpires", { minutes: minutesLeft })}</span> : null}
      </div>
    </div>
  );
}
