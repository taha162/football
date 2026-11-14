import { getLocale, getTranslations } from "next-intl/server";
import { publicEnv } from "@/lib/env";
import { formatDateTime, formatNumber } from "@/lib/format";
import { displayPhone } from "@/lib/phone";
import { createClient } from "@/lib/supabase/server";
import { bot, whatsappConfig } from "@/lib/whatsapp";
import { resumeWhatsappAction } from "@/server/whatsapp";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Alert, Card, CardBody, DefinitionList } from "@/components/ui/primitives";

/**
 * The WhatsApp bot, as a checklist like the Telegram one: are its settings
 * there, does the bot answer and is the number linked (with the QR code to
 * link it), is sending paused, and is the database ready. Each line says what
 * to fix.
 */
export async function WhatsappPanel() {
  const t = await getTranslations("admin");
  const locale = await getLocale();
  const cfg = whatsappConfig();
  const supabase = await createClient();
  const { data: summary, error: summaryError } = await supabase.rpc("admin_whatsapp_summary");
  const s = summary as { booking_messages: boolean; promo_left_today: number; sent_today: number; failed_today: number; queued: number; sending: number } | null;
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
          {!cfg.serviceRole ? <li>{bad(t("tgProblem.service_role_missing"))}</li> : null}
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
    }
  }
  items.push({ label: t("waDatabase"), value: summaryError ? bad(t("waDatabaseMissing")) : good(t("tgDatabaseOk")) });
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
