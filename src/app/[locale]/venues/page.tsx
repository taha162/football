import type { Metadata } from "next";
import { MapPinned } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getCurrentUser } from "@/lib/auth";
import { MATCH_FORMATS } from "@/lib/domain/match";
import { getAreas, getCities, localizedName } from "@/server/reference";
import { listVenues } from "@/server/venues/queries";
import { VenueCard } from "@/components/venue/venue-card";
import { buttonClass } from "@/components/ui/button";
import { Checkbox, Input, Select } from "@/components/ui/field";
import { Container, EmptyState, PageHeader } from "@/components/ui/primitives";
import { Pagination } from "@/components/ui/pagination";

export async function generateMetadata({ params }: PageProps<"/[locale]/venues">): Promise<Metadata> {
  const t = await getTranslations({ locale: (await params).locale, namespace: "venues" });
  return { title: t("title") };
}

const one = (v: string | string[] | undefined) => (typeof v === "string" && v ? v.slice(0, 80) : undefined);
const isUuid = (v?: string) => (v && /^[0-9a-f-]{36}$/.test(v) ? v : undefined);

export default async function VenuesPage({ params, searchParams }: PageProps<"/[locale]/venues">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  const t = await getTranslations("venues");
  const user = await getCurrentUser();
  const [cities, areas] = await Promise.all([getCities(), getAreas()]);
  const city = isUuid(one(sp.city)) ?? user?.profile.city_id ?? undefined;
  const format = MATCH_FORMATS.find((f) => f === one(sp.format));
  const page = Math.max(1, Number(one(sp.page) ?? 1) || 1);
  const { items, hasMore } = await listVenues({ q: one(sp.q), city, area: isUuid(one(sp.area)), format, bookable: one(sp.bookable) === "1", page });
  const query = Object.fromEntries(Object.entries(sp).filter(([k, v]) => k !== "page" && typeof v === "string" && v)) as Record<string, string>;

  return (
    <Container className="py-10">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={<Link href="/manage/venues/new" className={buttonClass("outline", "md")}>{t("listVenue")}</Link>}
      />
      <form method="get" className="mb-6 grid gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-4 sm:grid-cols-5">
        <label className="flex flex-col gap-1 text-sm sm:col-span-2">
          {t("search")}
          <Input name="q" defaultValue={one(sp.q)} placeholder={t("searchPlaceholder")} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t("city")}
          <Select name="city" defaultValue={city ?? ""}>
            {cities.map((c) => <option key={c.id} value={c.id}>{localizedName(c, locale)}</option>)}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t("area")}
          <Select name="area" defaultValue={one(sp.area) ?? ""}>
            <option value="">{t("anyArea")}</option>
            {areas.filter((a) => a.city_id === city).map((a) => <option key={a.id} value={a.id}>{localizedName(a, locale)}</option>)}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t("format")}
          <Select name="format" defaultValue={format ?? ""}>
            <option value="">—</option>
            {MATCH_FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}
          </Select>
        </label>
        <Checkbox name="bookable" value="1" defaultChecked={one(sp.bookable) === "1"} label={t("onlyBookable")} className="sm:col-span-3" />
        <button type="submit" className={buttonClass("primary", "md", "sm:col-span-2")}>{t("apply")}</button>
      </form>
      {items.length > 0 ? (
        <div className="flex flex-col gap-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((v) => <VenueCard key={v.id} venue={v} />)}
          </div>
          <Pagination pathname="/venues" query={query} page={page} hasMore={hasMore} />
        </div>
      ) : (
        <EmptyState icon={<MapPinned className="size-10" />} title={t("empty")}>{t("emptyBody")}</EmptyState>
      )}
    </Container>
  );
}
