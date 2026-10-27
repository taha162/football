import { getLocale, getTranslations } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { updateSettingAction, upsertAreaAction, upsertCityAction } from "@/server/admin";
import { ActionForm, Hidden, SubmitButton } from "@/components/ui/action-form";
import { Input, Select } from "@/components/ui/field";
import { Card, CardBody, PageHeader, Section } from "@/components/ui/primitives";

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
