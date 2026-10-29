import type { Metadata } from "next";
import { Suspense } from "react";
import { CalendarSearch, SlidersHorizontal } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { z } from "zod";
import Form from "next/form";
import { Link } from "@/i18n/navigation";
import { getCurrentUser } from "@/lib/auth";
import { JOIN_POLICIES, MATCH_FORMATS, POSITIONS, SKILL_LEVELS } from "@/lib/domain/match";
import { parseMoneyInput } from "@/lib/domain/money";
import { getMapProvider } from "@/lib/maps";
import { getAreas, getCities, localizedName } from "@/server/reference";
import { searchMatches, type MatchSearch } from "@/server/matches/queries";
import { MatchCard } from "@/components/match/match-card";
import { NearMe } from "@/components/match/near-me";
import { buttonClass } from "@/components/ui/button";
import { Checkbox, Input, Select } from "@/components/ui/field";
import { Alert, Container, EmptyState, PageHeader } from "@/components/ui/primitives";
import { Pagination } from "@/components/ui/pagination";

export async function generateMetadata({ params }: PageProps<"/[locale]/matches">): Promise<Metadata> {
  const t = await getTranslations({ locale: (await params).locale, namespace: "discovery" });
  return { title: t("title") };
}

const optional = <T extends z.ZodTypeAny>(s: T) => z.preprocess((v) => (v === "" || v == null ? undefined : v), s.optional());
const querySchema = z.object({
  q: optional(z.string().trim().max(80)),
  city: optional(z.string().uuid()),
  area: optional(z.string().uuid()),
  from: optional(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  to: optional(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  tfrom: optional(z.string().regex(/^\d{2}:\d{2}$/)),
  tto: optional(z.string().regex(/^\d{2}:\d{2}$/)),
  format: optional(z.enum(MATCH_FORMATS)),
  skill: optional(z.enum(SKILL_LEVELS)),
  price: optional(z.string()),
  position: optional(z.enum(POSITIONS)),
  slots: optional(z.coerce.number().int().min(1).max(30)),
  booked: optional(z.literal("1")),
  policy: optional(z.enum(JOIN_POLICIES)),
  open: optional(z.literal("1")),
  lat: optional(z.coerce.number().min(-90).max(90)),
  lng: optional(z.coerce.number().min(-180).max(180)),
  radius: optional(z.coerce.number().min(1).max(100)),
  sort: optional(z.enum(["time", "relevance", "distance"])),
  page: optional(z.coerce.number().int().min(1).max(500)),
});

export default async function MatchesPage({ params, searchParams }: PageProps<"/[locale]/matches">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("discovery");
  const e = await getTranslations("enums");
  const raw = Object.fromEntries(Object.entries(await searchParams).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
  const parsed = querySchema.safeParse(raw);
  const q = parsed.success ? parsed.data : {};
  const user = await getCurrentUser();
  const [cities, areas] = await Promise.all([getCities(), getAreas()]);
  const city = q.city ?? user?.profile.city_id ?? undefined;

  const search: MatchSearch = {
    city,
    area: q.area,
    dateFrom: q.from,
    dateTo: q.to,
    timeFrom: q.tfrom,
    timeTo: q.tto,
    format: q.format,
    skill: q.skill,
    maxPrice: q.price ? (parseMoneyInput(q.price, "IQD") ?? undefined) : undefined,
    position: q.position,
    minSlots: q.slots,
    bookingConfirmed: q.booked ? true : undefined,
    joinPolicy: q.policy,
    includeFull: !q.open,
    lat: q.lat,
    lng: q.lng,
    radiusKm: q.lat != null ? (q.radius ?? 10) : undefined,
    sort: q.sort ?? (q.lat != null ? "distance" : "relevance"),
    page: q.page,
    query: q.q,
  };
  const outcome = await searchMatches(search).then(
    (r) => ({ ...r, error: false }),
    () => ({ items: [], hasMore: false, error: true }),
  );
  const { error, ...result } = outcome;
  const query = Object.fromEntries(Object.entries(raw).filter(([k, v]) => k !== "page" && typeof v === "string" && v !== "")) as Record<string, string>;
  const cityAreas = areas.filter((a) => a.city_id === city);
  const activeFilters = Object.keys(query).filter((k) => !["sort", "city"].includes(k)).length;
  const mapUrl = getMapProvider().staticMapUrl(
    result.items.flatMap((m) => (m.venue?.latitude != null && m.venue.longitude != null ? [{ lat: Number(m.venue.latitude), lng: Number(m.venue.longitude) }] : [])),
    { width: 1100, height: 280 },
  );

  return (
    <Container className="py-10">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <Link href="/matches/new" className={buttonClass("primary", "md")}>
            {t("create")}
          </Link>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
        <aside aria-labelledby="filters-title">
          <details className="group rounded-[var(--radius-card)] border border-line bg-surface lg:open:block" open={activeFilters > 0 ? true : undefined}>
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 p-4 [&::-webkit-details-marker]:hidden">
              <span id="filters-title" className="flex items-center gap-2 font-semibold">
                <SlidersHorizontal aria-hidden="true" className="size-4" />
                {t("filters")}
                {activeFilters > 0 ? <span className="num rounded-full bg-accent px-2 text-xs text-accent-ink">{activeFilters}</span> : null}
              </span>
            </summary>
            <Form action="" scroll={false} className="flex flex-col gap-4 border-t border-line p-4">
              <label className="flex flex-col gap-1 text-sm">
                {t("search")}
                <Input type="search" name="q" defaultValue={q.q} placeholder={t("searchPlaceholder")} />
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
                <Select name="area" defaultValue={q.area ?? ""}>
                  <option value="">{t("anyArea")}</option>
                  {cityAreas.map((a) => (
                    <option key={a.id} value={a.id}>{localizedName(a, locale)}</option>
                  ))}
                </Select>
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1 text-sm">
                  {t("dateFrom")}
                  <Input type="date" name="from" defaultValue={q.from} dir="ltr" />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  {t("dateTo")}
                  <Input type="date" name="to" defaultValue={q.to} dir="ltr" />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  {t("timeFrom")}
                  <Input type="time" name="tfrom" defaultValue={q.tfrom} dir="ltr" />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  {t("timeTo")}
                  <Input type="time" name="tto" defaultValue={q.tto} dir="ltr" />
                </label>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1 text-sm">
                  {t("format")}
                  <Select name="format" defaultValue={q.format ?? ""}>
                    <option value="">{t("any")}</option>
                    {MATCH_FORMATS.map((f) => (
                      <option key={f} value={f}>{f}</option>
                    ))}
                  </Select>
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  {t("skill")}
                  <Select name="skill" defaultValue={q.skill ?? ""}>
                    <option value="">{t("any")}</option>
                    {SKILL_LEVELS.map((s) => (
                      <option key={s} value={s}>{e(`skill.${s}`)}</option>
                    ))}
                  </Select>
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  {t("position")}
                  <Select name="position" defaultValue={q.position ?? ""}>
                    <option value="">{t("any")}</option>
                    {POSITIONS.map((p) => (
                      <option key={p} value={p}>{e(`position.${p}`)}</option>
                    ))}
                  </Select>
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  {t("minSlots")}
                  <Input type="number" name="slots" min={1} max={30} defaultValue={q.slots} />
                </label>
              </div>
              <label className="flex flex-col gap-1 text-sm">
                {t("maxPrice")}
                <Input name="price" inputMode="numeric" defaultValue={q.price} dir="ltr" placeholder="10000" />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                {t("joinPolicy")}
                <Select name="policy" defaultValue={q.policy ?? ""}>
                  <option value="">{t("any")}</option>
                  <option value="open">{t("policyOpen")}</option>
                  <option value="approval">{t("policyApproval")}</option>
                </Select>
              </label>
              <Checkbox name="open" value="1" defaultChecked={Boolean(q.open)} label={t("onlyWithSlots")} />
              <Checkbox name="booked" value="1" defaultChecked={Boolean(q.booked)} label={t("onlyBooked")} />
              <label className="flex flex-col gap-1 text-sm">
                {t("sort")}
                <Select name="sort" defaultValue={search.sort}>
                  <option value="relevance">{t("sortRelevance")}</option>
                  <option value="time">{t("sortTime")}</option>
                  {q.lat != null ? <option value="distance">{t("sortDistance")}</option> : null}
                </Select>
              </label>
              {q.lat != null ? (
                <>
                  <input type="hidden" name="lat" value={q.lat} />
                  <input type="hidden" name="lng" value={q.lng} />
                  <label className="flex flex-col gap-1 text-sm">
                    {t("radius")}
                    <Select name="radius" defaultValue={String(q.radius ?? 10)}>
                      {[3, 5, 10, 20, 50].map((r) => (
                        <option key={r} value={r}>{t("km", { count: r })}</option>
                      ))}
                    </Select>
                  </label>
                </>
              ) : null}
              <div className="flex gap-2">
                <button type="submit" className={buttonClass("primary", "md", "flex-1")}>{t("apply")}</button>
                <Link href="/matches" className={buttonClass("ghost", "md")}>{t("reset")}</Link>
              </div>
            </Form>
            <div className="border-t border-line p-4">
              <Suspense fallback={null}>
                <NearMe />
              </Suspense>
            </div>
          </details>
        </aside>

        <section aria-label={t("results")} className="flex flex-col gap-4">
          {mapUrl ? (
            // Static map from the configured provider (only when credentials exist).
            // eslint-disable-next-line @next/next/no-img-element
            <img src={mapUrl} alt={t("mapAlt")} className="h-48 w-full rounded-[var(--radius-card)] border border-line object-cover" loading="lazy" />
          ) : null}
          {error ? <Alert tone="danger">{t("loadError")}</Alert> : null}
          {result.items.length > 0 ? (
            <>
              <p className="text-sm text-muted" aria-live="polite">{t("showing", { count: result.items.length })}</p>
              <div className="grid gap-4 sm:grid-cols-2">
                {result.items.map((m) => (
                  <MatchCard key={m.id} match={m} />
                ))}
              </div>
              <Pagination pathname="/matches" query={query} page={q.page ?? 1} hasMore={result.hasMore} />
            </>
          ) : !error ? (
            <EmptyState
              icon={<CalendarSearch className="size-10" />}
              title={t("emptyTitle")}
              action={
                <div className="flex flex-wrap justify-center gap-2">
                  <Link href="/matches/new" className={buttonClass("primary", "md")}>{t("create")}</Link>
                  {activeFilters > 0 ? <Link href="/matches" className={buttonClass("outline", "md")}>{t("reset")}</Link> : null}
                </div>
              }
            >
              {t("emptyBody")}
            </EmptyState>
          ) : null}
        </section>
      </div>
    </Container>
  );
}
