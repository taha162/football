import { getLocale, getTranslations } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { getCurrentUser } from "@/lib/auth";
import { publicEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { readWebhookState, telegramConfig } from "@/lib/telegram";
import { cloudflareIceServers, turnSetup } from "@/lib/turn";
import { updateSettingAction, upsertAreaAction, upsertCityAction } from "@/server/admin";
import { connectTelegramAction } from "@/server/telegram";
import { ActionForm, Hidden, SubmitButton } from "@/components/ui/action-form";
import { Input, Select } from "@/components/ui/field";
import { Alert, Card, CardBody, DefinitionList, PageHeader, Section } from "@/components/ui/primitives";

/**
 * The Telegram verification bot, as a checklist: are its settings there, does
 * Telegram accept the token, is the webhook pointed at this site, and is the
 * database ready. Each line says what to fix.
 */
async function TelegramPanel() {
  const t = await getTranslations("admin");
  const cfg = telegramConfig();
  const expected = `${publicEnv.siteUrl}/api/telegram/webhook`;
  const admin = createAdminClient();
  const dbReady = admin ? !(await admin.rpc("phone_verify_lookup", { p_ticket_hash: "0".repeat(64) })).error : false;
  const state = cfg.enabled ? await readWebhookState(cfg.token) : null;
  const connected = Boolean(state?.ok && state.result.url === expected);

  const bad = (text: React.ReactNode) => <span className="text-danger">{text}</span>;
  const good = (text: React.ReactNode) => <span className="text-success">{text}</span>;
  const items: { label: string; value: React.ReactNode }[] = [];

  items.push({
    label: t("tgSettings"),
    value:
      cfg.problems.length || !cfg.serviceRole ? (
        <ul className="flex flex-col gap-0.5">
          {cfg.problems.map((p) => <li key={p}>{bad(t(`tgProblem.${p}`))}</li>)}
          {!cfg.serviceRole ? <li>{bad(t("tgProblem.service_role_missing"))}</li> : null}
        </ul>
      ) : (
        good(<span dir="ltr">@{cfg.username}</span>)
      ),
  });
  if (state) {
    items.push({
      label: t("tgTelegramAnswer"),
      value: state.ok
        ? state.result.botUsername && state.result.botUsername.toLowerCase() !== cfg.username.toLowerCase()
          ? bad(<>{t("tgUsernameMismatch")} <span dir="ltr">@{state.result.botUsername}</span></>)
          : good(t("tgTokenOk"))
        : bad(state.error === "Unauthorized" ? t("tgTokenRejected") : state.error === "unreachable" || state.error === "timeout" ? t("tgUnreachable") : <span dir="ltr">{state.error}</span>),
    });
    if (state.ok) {
      items.push({
        label: t("tgWebhook"),
        value: connected
          ? good(t("tgConnected"))
          : state.result.url
            ? bad(<>{t("tgOtherUrl")} <span dir="ltr" className="break-all">{state.result.url}</span></>)
            : bad(t("tgNotConnected")),
      });
      if (state.result.lastError) {
        items.push({ label: t("tgLastError"), value: <span dir="ltr" className="break-all">{state.result.lastError}</span> });
      }
    }
  }
  items.push({ label: t("tgDatabase"), value: dbReady ? good(t("tgDatabaseOk")) : bad(t("tgDatabaseMissing")) });

  return (
    <Card>
      <CardBody className="flex flex-col gap-4">
        <DefinitionList items={items} />
        <p className="text-xs text-muted">
          {t("tgExpectedUrl")} <span dir="ltr" className="break-all font-mono">{expected}</span>
        </p>
        {cfg.enabled ? (
          <ActionForm action={connectTelegramAction}>
            <p className="text-xs text-muted">{t("tgConnectHint")}</p>
            <SubmitButton variant={connected ? "secondary" : "primary"} className="self-start">
              {connected ? t("tgReconnect") : t("tgConnect")}
            </SubmitButton>
          </ActionForm>
        ) : (
          <Alert tone="warning" title={t("tgNotConfigured")}>{t("tgNotConfiguredHint")}</Alert>
        )}
      </CardBody>
    </Card>
  );
}

/**
 * Voice calls: is the database ready, and is a TURN relay configured (calls
 * between some mobile networks need one). With Cloudflare, it checks that the
 * key works.
 */
async function CallsPanel() {
  const t = await getTranslations("admin");
  const admin = createAdminClient();
  const dbReady = admin ? !(await admin.from("calls").select("id").limit(1)).error : false;
  const setup = turnSetup();
  const check = setup.kind === "cloudflare" ? await cloudflareIceServers(setup.keyId, setup.token) : null;
  const bad = (text: React.ReactNode) => <span className="text-danger">{text}</span>;
  const good = (text: React.ReactNode) => <span className="text-success">{text}</span>;
  const items: { label: string; value: React.ReactNode }[] = [
    { label: t("callsDatabase"), value: dbReady ? good(t("callsDatabaseOk")) : bad(t("callsDatabaseMissing")) },
    {
      label: t("callsRelay"),
      value:
        setup.kind === "cloudflare"
          ? check?.ok
            ? good(t("callsRelayCloudflare"))
            : bad(<>{t("callsRelayRejected")} <span dir="ltr">({check && !check.ok ? check.error : ""})</span></>)
          : setup.kind === "static"
            ? good(t("callsRelayStatic"))
            : <span className="text-warning">{t("callsRelayNone")}</span>,
    },
  ];
  return (
    <Card>
      <CardBody className="flex flex-col gap-3">
        <DefinitionList items={items} />
        <p className="text-xs text-muted">{t("callsHint")}</p>
      </CardBody>
    </Card>
  );
}

export default async function AdminSettingsPage() {
  const locale = await getLocale();
  if (!(await getCurrentUser())?.isAdmin) redirect({ href: "/admin", locale });
  const t = await getTranslations("admin");
  const supabase = await createClient();
  const [{ data: settings }, { data: cities }, { data: areas }] = await Promise.all([
    supabase.from("platform_settings").select("*").order("key"),
    supabase.from("cities").select("*").order("sort_order"),
    supabase.from("areas").select("*").order("slug"),
  ]);
  return (
    <>
      <PageHeader title={t("nav.settings")} />
      <Section title={t("telegramBot")} id="telegram">
        <TelegramPanel />
      </Section>
      <Section title={t("voiceCalls")} id="calls">
        <CallsPanel />
      </Section>
      <Section title={t("policies")} id="policies">
        <ul className="flex flex-col gap-2">
          {(settings ?? []).map((s) => (
            <li key={s.key} className="rounded-xl border border-line p-3">
              <ActionForm action={updateSettingAction} className="gap-2 sm:flex-row sm:items-end">
                <Hidden values={{ key: s.key }} />
                <label className="flex flex-1 flex-col gap-1 text-sm">
                  <span className="font-mono text-xs" dir="ltr">{s.key}</span>
                  <span className="text-xs text-muted">{s.description}</span>
                  <Input name="value" defaultValue={JSON.stringify(s.value)} dir="ltr" />
                </label>
                <SubmitButton size="md" variant="secondary">{t("update")}</SubmitButton>
              </ActionForm>
            </li>
          ))}
        </ul>
      </Section>

      <Section title={t("cities")} id="cities">
        {(cities ?? []).map((c) => (
          <Card key={c.id}>
            <CardBody>
              <ActionForm action={upsertCityAction} className="grid gap-2 sm:grid-cols-4">
                <Hidden values={{ id: c.id }} />
                <Input name="slug" defaultValue={c.slug} aria-label="slug" dir="ltr" />
                <Input name="name_en" defaultValue={c.name_en} aria-label={t("nameEn")} />
                <Input name="name_ar" defaultValue={c.name_ar} aria-label={t("nameAr")} dir="rtl" />
                <Input name="timezone" defaultValue={c.timezone} aria-label={t("timezone")} dir="ltr" />
                <Input name="country_code" defaultValue={c.country_code} aria-label={t("country")} dir="ltr" />
                <Input name="currency" defaultValue={c.currency} aria-label={t("currency")} dir="ltr" />
                <Select name="is_active" defaultValue={c.is_active ? "1" : "0"} aria-label={t("active")}>
                  <option value="1">{t("active")}</option>
                  <option value="0">{t("inactive")}</option>
                </Select>
                <SubmitButton variant="secondary">{t("update")}</SubmitButton>
              </ActionForm>
            </CardBody>
          </Card>
        ))}
        <Card>
          <CardBody>
            <p className="mb-2 text-sm font-semibold">{t("addCity")}</p>
            <ActionForm action={upsertCityAction} resetOnSuccess className="grid gap-2 sm:grid-cols-4">
              <Input name="slug" placeholder="erbil" aria-label="slug" dir="ltr" required />
              <Input name="name_en" placeholder="Erbil" aria-label={t("nameEn")} required />
              <Input name="name_ar" placeholder="أربيل" aria-label={t("nameAr")} required dir="rtl" />
              <Input name="timezone" defaultValue="Asia/Baghdad" aria-label={t("timezone")} dir="ltr" required />
              <Input name="country_code" defaultValue="IQ" aria-label={t("country")} dir="ltr" required />
              <Input name="currency" defaultValue="IQD" aria-label={t("currency")} dir="ltr" required />
              <SubmitButton>{t("add")}</SubmitButton>
            </ActionForm>
          </CardBody>
        </Card>
      </Section>

      <Section title={t("areas")} id="areas">
        <Card>
          <CardBody>
            <p className="mb-2 text-sm font-semibold">{t("addArea")}</p>
            <ActionForm action={upsertAreaAction} resetOnSuccess className="grid gap-2 sm:grid-cols-5">
              <Select name="city_id" aria-label={t("city")}>
                {(cities ?? []).map((c) => <option key={c.id} value={c.id}>{locale === "ar" ? c.name_ar : c.name_en}</option>)}
              </Select>
              <Input name="slug" placeholder="al-zuhur" aria-label="slug" dir="ltr" required />
              <Input name="name_en" aria-label={t("nameEn")} placeholder={t("nameEn")} required />
              <Input name="name_ar" aria-label={t("nameAr")} placeholder={t("nameAr")} required dir="rtl" />
              <SubmitButton>{t("add")}</SubmitButton>
            </ActionForm>
          </CardBody>
        </Card>
        <ul className="grid gap-1 text-sm sm:grid-cols-3">
          {(areas ?? []).map((a) => (
            <li key={a.id} className="rounded-lg bg-surface-2 px-3 py-1.5">
              {locale === "ar" ? a.name_ar : a.name_en} <span className="font-mono text-xs text-faint" dir="ltr">{a.slug}</span>
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}
