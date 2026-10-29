import type { Metadata } from "next";
import { Users } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import Form from "next/form";
import { getCurrentUser } from "@/lib/auth";
import { MATCH_FORMATS, SKILL_LEVELS } from "@/lib/domain/match";
import { getAreas, getCities, localizedName } from "@/server/reference";
import { listTeams } from "@/server/teams/queries";
import { TeamCard } from "@/components/team/team-card";
import { buttonClass } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { Container, EmptyState, PageHeader } from "@/components/ui/primitives";
import { Pagination } from "@/components/ui/pagination";
import { LinkButton } from "@/components/ui/link-button";

export async function generateMetadata({ params }: PageProps<"/[locale]/teams">): Promise<Metadata> {
  const t = await getTranslations({ locale: (await params).locale, namespace: "teams" });
  return { title: t("title") };
}

const one = (v: string | string[] | undefined) => (typeof v === "string" && v ? v.slice(0, 80) : undefined);
const isUuid = (v?: string) => (v && /^[0-9a-f-]{36}$/.test(v) ? v : undefined);

export default async function TeamsPage({ params, searchParams }: PageProps<"/[locale]/teams">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  const t = await getTranslations("teams");
  const e = await getTranslations("enums");
  const user = await getCurrentUser();
  const [cities, areas] = await Promise.all([getCities(), getAreas()]);
  const city = isUuid(one(sp.city)) ?? user?.profile.city_id ?? undefined;
  const format = MATCH_FORMATS.find((f) => f === one(sp.format));
  const skill = SKILL_LEVELS.find((s) => s === one(sp.skill));
  const page = Math.max(1, Number(one(sp.page) ?? 1) || 1);
  const { items, hasMore } = await listTeams({ q: one(sp.q), city, area: isUuid(one(sp.area)), format, skill, page });
  const query = Object.fromEntries(Object.entries(sp).filter(([k, v]) => k !== "page" && typeof v === "string" && v)) as Record<string, string>;

  return (
    <Container className="py-10">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <>
            <LinkButton href="/recruitment" className={buttonClass("outline", "md")}>{t("recruiting")}</LinkButton>
            <LinkButton href="/teams/new" className={buttonClass("primary", "md")}>{t("create")}</LinkButton>
          </>
        }
      />
      <Form action="" scroll={false} className="mb-6 grid gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-4 sm:grid-cols-5">
        <label className="flex flex-col gap-1 text-sm sm:col-span-2">
          {t("search")}
          <Input name="q" defaultValue={one(sp.q)} placeholder={t("searchPlaceholder")} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t("city")}
          <Select name="city" defaultValue={city ?? ""}>
            {cities.map((c) => (
              <option key={c.id} value={c.id}>{localizedName(c, locale)}</option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t("area")}
          <Select name="area" defaultValue={one(sp.area) ?? ""}>
            <option value="">{t("anyArea")}</option>
            {areas.filter((a) => a.city_id === city).map((a) => (
              <option key={a.id} value={a.id}>{localizedName(a, locale)}</option>
            ))}
          </Select>
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-sm">
            {t("format")}
            <Select name="format" defaultValue={format ?? ""}>
              <option value="">—</option>
              {MATCH_FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {t("skill")}
            <Select name="skill" defaultValue={skill ?? ""}>
              <option value="">—</option>
              {SKILL_LEVELS.map((s) => <option key={s} value={s}>{e(`skill.${s}`)}</option>)}
            </Select>
          </label>
        </div>
        <button type="submit" className={buttonClass("primary", "md", "sm:col-start-5")}>{t("apply")}</button>
      </Form>
      {items.length > 0 ? (
        <div className="flex flex-col gap-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((team) => <TeamCard key={team.id} team={team} />)}
          </div>
          <Pagination pathname="/teams" query={query} page={page} hasMore={hasMore} />
        </div>
      ) : (
        <EmptyState icon={<Users className="size-10" />} title={t("empty")} action={<LinkButton href="/teams/new" className={buttonClass("primary", "md")}>{t("create")}</LinkButton>} />
      )}
    </Container>
  );
}
