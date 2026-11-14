import { getLocale, getTranslations } from "next-intl/server";
import { Link, redirect } from "@/i18n/navigation";
import { getCurrentUser } from "@/lib/auth";
import { formatDateTime, formatNumber } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { bot, whatsappConfig } from "@/lib/whatsapp";
import { stopCampaignAction } from "@/server/whatsapp";
import { CampaignComposer, type AudienceOption } from "@/components/admin/campaign-composer";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { Alert, Badge, Card, CardBody, DefinitionList, PageHeader, Section } from "@/components/ui/primitives";

type Campaign = {
  id: string;
  body: string;
  city_id: string | null;
  status: "sending" | "stopped" | "done";
  recipients: number;
  created_by_name: string | null;
  created_at: string;
  queued: number;
  sending: number;
  sent: number;
  failed: number;
  skipped: number;
};

/**
 * Promotional WhatsApp messages (admins only). They go only to people who
 * ticked the opt-in box, slowly, through the same queue as booking messages,
 * and every one ends with how to stop them. The database checks the role
 * again and audits each campaign.
 */
export default async function AdminPromotionsPage() {
  const locale = await getLocale();
  const user = await getCurrentUser();
  if (!user?.isAdmin) redirect({ href: "/admin", locale });
  const t = await getTranslations("admin");
  const cfg = whatsappConfig();
  const supabase = await createClient();
  const [{ data: audience, error: audienceError }, { data: campaigns }, { data: summary }, { data: cities }, health] = await Promise.all([
    supabase.rpc("admin_whatsapp_audience"),
    supabase.rpc("admin_whatsapp_campaigns", { p_limit: 20 }),
    supabase.rpc("admin_whatsapp_summary"),
    supabase.from("cities").select("id, name_ar, name_en").order("sort_order"),
    cfg.canSend ? bot.health() : Promise.resolve(null),
  ]);
  const a = (audience ?? { total: 0, by_city: {} }) as { total: number; by_city: Record<string, number> };
  const s = summary as { promo_left_today: number; opted_in: number } | null;
  const cityName = new Map((cities ?? []).map((c) => [c.id, locale === "ar" ? c.name_ar : c.name_en]));
  const options: AudienceOption[] = [
    { value: "", label: t("promoEveryone", { count: formatNumber(a.total, locale) }), count: a.total },
    ...Object.entries(a.by_city)
      .filter(([id]) => cityName.has(id))
      .map(([id, n]) => ({ value: id, label: t("promoCity", { city: cityName.get(id)!, count: formatNumber(n, locale) }), count: n })),
  ];
  const list = (campaigns ?? []) as Campaign[];
  const active = list.some((c) => c.status === "sending");
  const botState = health?.ok ? (health.data.paused ? "paused" : health.data.linked ? "ready" : "not_linked") : "unreachable";

  return (
    <>
      <PageHeader title={t("nav.promotions")} description={t("promotionsDescription")} />
      {!cfg.canSend ? (
        <Alert tone="warning" title={t("waNotConfigured")}>
          <Link href="/admin/settings#whatsapp-title" className="text-accent underline">{t("promoSetUp")}</Link>
        </Alert>
      ) : audienceError ? (
        <Alert tone="warning" title={t("waDatabaseMissing")} />
      ) : null}

      <Card>
        <CardBody>
          <DefinitionList
            items={[
              { label: t("promoOptedIn"), value: formatNumber(s?.opted_in ?? a.total, locale) },
              { label: t("promoLeftToday"), value: formatNumber(s?.promo_left_today ?? 0, locale) },
              {
                label: t("waBotAnswer"),
                value: (
                  <span className={botState === "ready" ? "text-success" : "text-danger"}>
                    {t(`promoBot.${cfg.canSend ? botState : "not_configured"}`)}
                  </span>
                ),
              },
            ]}
          />
          <p className="mt-3 text-xs text-muted">{t("promoPacingHint")}</p>
        </CardBody>
      </Card>

      <Section title={t("promoNew")} id="new-campaign">
        <Card>
          <CardBody>
            {active ? <Alert tone="info" title={t("promoOneAtATime")} /> : null}
            <CampaignComposer audiences={options} sampleName={user!.profile.display_name} disabled={!cfg.canSend || active || Boolean(audienceError)} />
          </CardBody>
        </Card>
      </Section>

      <Section title={t("promoCampaigns")} id="campaigns">
        {list.length === 0 ? (
          <p className="text-sm text-muted">{t("promoNone")}</p>
        ) : (
          <div className="relative overflow-x-auto rounded-xl border border-line">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-xs text-muted">
                <tr>
                  <th className="p-2 text-start">{t("when")}</th>
                  <th className="p-2 text-start">{t("promoMessage")}</th>
                  <th className="p-2 text-start">{t("promoAudience")}</th>
                  <th className="p-2 text-start">{t("status")}</th>
                  <th className="p-2 text-start">{t("promoReport")}</th>
                  <th className="p-2"><span className="sr-only">{t("handle")}</span></th>
                </tr>
              </thead>
              <tbody>
                {list.map((c) => (
                  <tr key={c.id} className="border-t border-line align-top" data-testid="campaign-row">
                    <td className="whitespace-nowrap p-2 text-muted">
                      {formatDateTime(c.created_at, locale, "Asia/Baghdad")}
                      <div className="text-xs">{c.created_by_name ?? t("system")}</div>
                    </td>
                    <td className="min-w-48 max-w-xs p-2">
                      <p className="line-clamp-3 whitespace-pre-wrap">{c.body}</p>
                    </td>
                    <td className="min-w-28 p-2">
                      {c.city_id ? cityName.get(c.city_id) ?? "—" : t("promoAll")}
                      <div className="text-xs text-muted">{t("promoRecipients", { count: formatNumber(c.recipients, locale) })}</div>
                    </td>
                    <td className="p-2">
                      <Badge tone={c.status === "sending" ? "info" : c.status === "done" ? "success" : "neutral"}>{t(`promoStatus.${c.status}`)}</Badge>
                    </td>
                    <td className="whitespace-nowrap p-2 text-xs">
                      {t("promoReportValue", {
                        sent: formatNumber(c.sent, locale),
                        failed: formatNumber(c.failed, locale),
                        skipped: formatNumber(c.skipped, locale),
                        waiting: formatNumber(c.queued + c.sending, locale),
                      })}
                    </td>
                    <td className="p-2 text-end">
                      {c.status === "sending" ? (
                        <ConfirmAction
                          action={stopCampaignAction}
                          values={{ campaign_id: c.id }}
                          label={t("promoStop")}
                          title={t("promoStopTitle")}
                          description={t("promoStopBody", { waiting: formatNumber(c.queued + c.sending, locale) })}
                          confirmLabel={t("promoStop")}
                        />
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </>
  );
}
