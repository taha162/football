import { getLocale, getTranslations } from "next-intl/server";
import { publicEnv } from "@/lib/env";
import { formatDate, formatDateTime, formatNumber, formatTime } from "@/lib/format";
import { displayPhone } from "@/lib/phone";
import { createClient } from "@/lib/supabase/server";
import { bot, whatsappConfig, type BotHealth, type SiteCheckState } from "@/lib/whatsapp";
import { resumeWhatsappAction } from "@/server/whatsapp";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Alert, Card, CardBody, DefinitionList } from "@/components/ui/primitives";

const SITE_STATES: SiteCheckState[] = ["checking", "ok", "refused_secret", "blocked", "redirected", "not_found", "old_site", "error", "unreachable"];
const INBOUND_KINDS = ["code", "stop", "help", "other"];
const GOOD_OUTCOMES = new Set(["replied", "help_sent"]);
const BAD_OUTCOMES = new Set(["no_number", "unreadable", "lid_lookup_failed", "site_refused_secret", "site_refused", "site_error", "site_unreachable"]);
const WARN_OUTCOMES = new Set(["other_number"]);
/** WhatsApp gives send times to the second: below this, a message reached the bot right away. */
const LATE_MS = 5000;

/**
 * The WhatsApp bot, as a checklist: are its settings there, does the bot
 * answer and is the number linked (with the QR code to link it), is sending
 * paused, can the bot reach this site, what became of the latest messages
 * people sent it (and how fast), and is the database ready. Each line says
 * what to fix.
 */
export async function WhatsappPanel() {
  const t = await getTranslations("admin");
  const locale = await getLocale();
  const cfg = whatsappConfig();
  const supabase = await createClient();
  const { data: summary, error: summaryError } = await supabase.rpc("admin_whatsapp_summary");
  const s = summary as {
    schema?: number;
    booking_messages: boolean;
    promo_left_today: number;
    sent_today: number;
    failed_today: number;
    queued: number;
    sending: number;
  } | null;
  const [health, link] = cfg.canSend ? await Promise.all([bot.health(), bot.link()]) : [null, null];

  const bad = (text: React.ReactNode) => <span className="text-danger">{text}</span>;
  const good = (text: React.ReactNode) => <span className="text-success">{text}</span>;
  const items: { label: string; value: React.ReactNode }[] = [];

  items.push({
    label: t("waSettings"),
    value:
      cfg.problems.length || !cfg.serviceRole ? (
        <ul className="flex flex-col gap-0.5">
          {cfg.problems.map((p) => <li key={p}>{bad(t(`waProblem.${p}`))}</li>)}
          {!cfg.serviceRole ? <li>{bad(t("waProblem.service_role_missing"))}</li> : null}
        </ul>
      ) : (
        good(<span dir="ltr">{displayPhone(cfg.number)}</span>)
      ),
  });
  if (health) {
    items.push({
      label: t("waBotAnswer"),
      value: health.ok
        ? health.data.linked
          ? good(<>{t("waLinked")} {health.data.number ? <span dir="ltr">{displayPhone(health.data.number)}</span> : null}</>)
          : bad(t("waNotLinked"))
        : bad(health.error === "unauthorized" || health.status === 401 ? t("waSecretRejected") : t("waUnreachable")),
    });
    if (health.ok) {
      const h = health.data;
      items.push({
        label: t("waSending"),
        value: h.paused
          ? bad(
              <>
                {t(`waPause.${["consecutive_errors", "ban_signal", "logged_out"].includes(h.paused.reason) ? h.paused.reason : "other"}`)}
                {h.paused.until ? <> · {t("waPausedUntil", { time: formatDateTime(h.paused.until, locale, "Asia/Baghdad") })}</> : null}
              </>,
            )
          : good(t("waSendingOk")),
      });
      items.push({
        label: t("waBotQueue"),
        value: t("waBotQueueValue", {
          total: formatNumber(h.queue.total, locale),
          hour: formatNumber(h.sent.lastHour, locale),
          perHour: formatNumber(h.caps.perHour, locale),
          today: formatNumber(h.sent.today, locale),
          perDay: formatNumber(h.caps.perDay, locale),
        }),
      });
      items.push({ label: t("waSiteReach"), value: <SiteReach site={h.site} /> });
      if (h.inbound) items.push({ label: t("waInbound"), value: <Inbound notes={h.inbound} locale={locale} /> });
    }
  }
  items.push({
    label: t("waDatabase"),
    // Each file says so in the summary: before 0029 WhatsApp sign-up can't ask for the number;
    // before 0031 offers go without a picture, a place or a link.
    value: summaryError
      ? bad(t("waDatabaseMissing"))
      : (s?.schema ?? 0) < 29
        ? bad(t("waDatabaseOld"))
        : (s?.schema ?? 0) < 31
          ? <span className="text-warning">{t("waDatabaseOld31")}</span>
          : good(t("waDatabaseOk")),
  });
  if (s) {
    items.push({
      label: t("waBookingMessages"),
      value: s.booking_messages ? (
        good(t("waOn"))
      ) : (
        <span className="text-warning">
          {t.rich("waBookingMessagesOff", { code: (c) => <code dir="ltr" className="font-mono text-xs">{c}</code> })}
        </span>
      ),
    });
    items.push({
      label: t("waSiteQueue"),
      value: t("waSiteQueueValue", {
        queued: formatNumber(s.queued, locale),
        sending: formatNumber(s.sending, locale),
        sent: formatNumber(s.sent_today, locale),
        failed: formatNumber(s.failed_today, locale),
      }),
    });
  }

  const qr = link?.ok && link.data.state === "qr" && link.data.qrSvg ? Buffer.from(link.data.qrSvg).toString("base64") : null;
  const pairing = link?.ok && link.data.state === "pairing" ? link.data.pairingCode : null;

  return (
    <Card>
      <CardBody className="flex flex-col gap-4">
        <DefinitionList items={items} />
        <p className="text-xs text-muted">
          {t("waExpectedUrl")} <span dir="ltr" className="break-all font-mono">{publicEnv.siteUrl}/api/whatsapp/webhook</span>
        </p>
        {qr ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-line p-4">
            <p className="text-sm font-semibold">{t("waLinkTitle")}</p>
            {/* An <img>, not inline markup: nothing in the picture can run. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`data:image/svg+xml;base64,${qr}`} alt={t("waQrAlt")} width={232} height={232} className="rounded-lg bg-white p-2" />
            <p className="max-w-sm text-center text-xs text-muted">{t("waLinkSteps")}</p>
          </div>
        ) : null}
        {pairing ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-line p-4">
            <p className="text-sm font-semibold">{t("waPairingTitle")}</p>
            <span className="num font-display text-3xl font-extrabold tracking-[0.2em] text-accent" dir="ltr">{pairing}</span>
            <p className="max-w-sm text-center text-xs text-muted">{t("waPairingSteps")}</p>
          </div>
        ) : null}
        {health?.ok && health.data.paused ? (
          <ActionForm action={resumeWhatsappAction}>
            <p className="text-xs text-muted">{t("waResumeHint")}</p>
            <SubmitButton variant="secondary" className="self-start">{t("waResume")}</SubmitButton>
          </ActionForm>
        ) : null}
        {!cfg.enabled ? <Alert tone="warning" title={t("waNotConfigured")}>{t("waNotConfiguredHint")}</Alert> : null}
      </CardBody>
    </Card>
  );
}

/** Can the bot reach this site with the secret (its SITE_URL check), and what to change when it can't. */
async function SiteReach({ site }: { site: BotHealth["site"] }) {
  const t = await getTranslations("admin");
  if (!site) return <span className="text-warning">{t("waSiteUnknown")}</span>;
  const state = SITE_STATES.includes(site.state) ? site.state : "error";
  const addr = (c: React.ReactNode) => (
    <span dir="ltr" className="break-all font-mono text-xs">
      {c}
    </span>
  );
  const text = state === "ok" ? t("waSiteOk") : t.rich(`waSiteState.${state}`, { status: String(site.status ?? "—"), to: site.to ?? "—", addr });
  return (
    <div className="flex flex-col gap-0.5" data-testid="wa-site">
      <span className={state === "ok" ? "text-success" : state === "checking" ? "text-muted" : "text-danger"}>{text}</span>
      <span className="text-xs text-muted">
        {t("waSiteUses")} {addr(site.url)}
      </span>
    </div>
  );
}

/**
 * The latest messages people sent the bot: when, what kind, what became of
 * them, how long the answer took, and whether WhatsApp held them back (the
 * bot was offline or reconnecting).
 */
async function Inbound({ notes, locale }: { notes: NonNullable<BotHealth["inbound"]>; locale: string }) {
  const t = await getTranslations("admin");
  if (notes.length === 0) return <span className="text-muted">{t("waInboundNone")}</span>;
  // Today's messages by the time alone; older ones with the day.
  const today = formatDate(new Date(), locale, "Asia/Baghdad");
  const when = (at: string) =>
    formatDate(at, locale, "Asia/Baghdad") === today ? formatTime(at, locale, "Asia/Baghdad") : formatDateTime(at, locale, "Asia/Baghdad", { weekday: undefined });
  const took = (ms: number) => t("waInboundTook", { seconds: formatNumber(Math.round(ms / 100) / 10, locale) });
  const late = (ms: number) =>
    ms < 60_000
      ? t("waInboundLate", { seconds: formatNumber(Math.round(ms / 1000), locale) })
      : t("waInboundLateMinutes", { minutes: formatNumber(Math.round(ms / 60_000), locale) });
  return (
    <ul className="flex flex-col gap-1" data-testid="wa-inbound">
      {notes.slice(0, 6).map((n, i) => {
        const outcome = `waInboundOutcome.${n.outcome}`;
        const tone = GOOD_OUTCOMES.has(n.outcome)
          ? "text-success"
          : BAD_OUTCOMES.has(n.outcome)
            ? "text-danger"
            : WARN_OUTCOMES.has(n.outcome)
              ? "text-warning"
              : "text-muted";
        return (
          <li key={`${n.at}-${i}`}>
            <span className="num text-muted">{when(n.at)}</span>
            {" · "}
            {t(`waInboundKind.${INBOUND_KINDS.includes(n.kind) ? n.kind : "other"}`)}
            {" · "}
            <span className={tone}>{t.has(outcome) ? t(outcome) : n.outcome}</span>
            {typeof n.tookMs === "number" ? <span className="text-muted"> · {took(n.tookMs)}</span> : null}
            {typeof n.lateMs === "number" && n.lateMs >= LATE_MS ? <span className="text-warning"> · {late(n.lateMs)}</span> : null}
          </li>
        );
      })}
    </ul>
  );
}
