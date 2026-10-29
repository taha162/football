import type { Metadata } from "next";
import { getLocale, getTranslations, setRequestLocale } from "next-intl/server";
import Form from "next/form";
import { Link } from "@/i18n/navigation";
import { POSITIONS } from "@/lib/domain/match";
import { formatDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { localizedName } from "@/server/reference";
import { TeamLogo } from "@/components/team/team-card";
import { buttonClass } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { Badge, Card, CardBody, Container, EmptyState, PageHeader } from "@/components/ui/primitives";
import { LinkButton } from "@/components/ui/link-button";

export async function generateMetadata({ params }: PageProps<"/[locale]/recruitment">): Promise<Metadata> {
  const t = await getTranslations({ locale: (await params).locale, namespace: "recruitment" });
  return { title: t("title") };
}

export default async function RecruitmentPage({ params, searchParams }: PageProps<"/[locale]/recruitment">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("recruitment");
  const e = await getTranslations("enums");
  const loc = await getLocale();
  const requested = (await searchParams).position;
  const position = POSITIONS.find((p) => p === requested);
  const supabase = await createClient();
  let query = supabase
    .from("team_recruitment")
    .select("*, team:teams(id, name, logo_path, city:cities(name_en, name_ar, timezone), area:areas(name_en, name_ar))")
    .eq("status", "open")
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(50);
  if (position) query = query.or(`positions.cs.{${position}},positions.eq.{}`);
  const { data } = await query;
  const rows = (data ?? []).filter((r) => r.team);

  return (
    <Container className="py-10">
      <PageHeader title={t("title")} description={t("description")} />
      <Form action="" scroll={false} className="mb-6 flex items-end gap-2">
        <label className="flex flex-col gap-1 text-sm">
          {t("position")}
          <Select name="position" defaultValue={position ?? ""}>
            <option value="">{t("any")}</option>
            {POSITIONS.map((p) => <option key={p} value={p}>{e(`position.${p}`)}</option>)}
          </Select>
        </label>
        <button type="submit" className={buttonClass("secondary", "md")}>{t("filter")}</button>
      </Form>
      {rows.length === 0 ? (
        <EmptyState title={t("empty")} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {rows.map((r) => (
            <Card key={r.id}>
              <CardBody className="flex flex-col gap-3">
                <div className="flex items-center gap-3">
                  <TeamLogo path={r.team!.logo_path} name={r.team!.name} size={40} />
                  <div>
                    <Link href={`/teams/${r.team!.id}`} className="font-semibold hover:underline">{r.team!.name}</Link>
                    <p className="text-xs text-muted">{[localizedName(r.team!.area, loc), localizedName(r.team!.city, loc)].filter(Boolean).join("، ")}</p>
                  </div>
                </div>
                <h2 className="font-display text-lg font-semibold">{r.title}</h2>
                <div className="flex flex-wrap gap-1.5">
                  {r.positions.length === 0 ? <Badge tone="accent">{t("anyPosition")}</Badge> : r.positions.map((p) => <Badge key={p} tone="accent">{e(`position.${p}`)}</Badge>)}
                  {r.skill_level ? <Badge tone="info">{e(`skill.${r.skill_level}`)}</Badge> : null}
                  <Badge>{t("needed", { count: r.players_needed })}</Badge>
                </div>
                {r.description ? <p className="text-sm text-muted">{r.description}</p> : null}
                <div className="flex items-center justify-between">
                  <span className="text-xs text-faint">{t("expires", { date: formatDate(r.expires_at, loc, r.team!.city?.timezone ?? "Asia/Baghdad") })}</span>
                  <LinkButton href={`/teams/${r.team!.id}#recruiting`} className={buttonClass("primary", "sm")}>{t("apply")}</LinkButton>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </Container>
  );
}
