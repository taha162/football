import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BadgeCheck, CalendarCheck, Settings } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getCurrentUser } from "@/lib/auth";
import { formatMoney } from "@/lib/domain/money";
import { acceptsPlatformBookings } from "@/lib/domain/venue";
import { formatDate } from "@/lib/format";
import { getMapProvider } from "@/lib/maps";
import { publicStorageUrl } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";
import { localizedName } from "@/server/reference";
import { MATCH_CARD_SELECT, type MatchCardData } from "@/server/matches/queries";
import { getDepositSettings, getVenue } from "@/server/venues/queries";
import { MatchCard } from "@/components/match/match-card";
import { ReportButton } from "@/components/report-button";
import { OpeningHours } from "@/components/venue/opening-hours";
import { StorageImage } from "@/components/ui/avatar";
import { buttonClass } from "@/components/ui/button";
import { Alert, Badge, Card, CardBody, Container, Section } from "@/components/ui/primitives";
import { ExternalLinkButton, LinkButton } from "@/components/ui/link-button";

export async function generateMetadata({ params }: PageProps<"/[locale]/venues/[id]">): Promise<Metadata> {
  const v = await getVenue((await params).id);
  return { title: v?.name ?? "—" };
}

export default async function VenuePage({ params }: PageProps<"/[locale]/venues/[id]">) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const venue = await getVenue(id);
  if (!venue) notFound();
  const t = await getTranslations("venuePage");
  const v = await getTranslations("venues");
  const user = await getCurrentUser();
  const supabase = await createClient();
  const [{ data: matches }, { data: reviews }, { data: rating }, { data: staff }, deposits] = await Promise.all([
    supabase.from("matches").select(MATCH_CARD_SELECT).eq("venue_id", id).in("status", ["open", "full", "confirmed"]).gt("starts_at", new Date().toISOString()).order("starts_at").limit(6),
    supabase.from("reviews").select("id, venue_rating, comment, created_at").eq("venue_id", id).eq("status", "published").order("created_at", { ascending: false }).limit(10),
    supabase.rpc("venue_rating", { p_venue_id: id }),
    user ? supabase.from("venue_staff").select("role").eq("venue_id", id).eq("user_id", user.id).maybeSingle() : Promise.resolve({ data: null }),
    getDepositSettings(),
  ]);
  const tz = venue.city?.timezone ?? "Asia/Baghdad";
  const bookable = acceptsPlatformBookings(venue, deposits.on);
  const point = venue.latitude != null && venue.longitude != null ? { lat: Number(venue.latitude), lng: Number(venue.longitude) } : null;
  const provider = getMapProvider();
  const mapUrl = point ? provider.staticMapUrl([point], { width: 640, height: 320 }) : null;
  const cover = publicStorageUrl("venue-images", venue.cover_image_path);
  const r = (rating ?? { count: 0, average: null }) as { count: number; average: number | null };
  const fields = (venue.fields ?? []).filter((f) => f.is_active);
  const dayName = (d: number) => new Intl.DateTimeFormat(locale === "ar" ? "ar-IQ" : "en-GB", { weekday: "short", timeZone: "UTC" }).format(new Date(Date.UTC(2024, 0, 7 + d)));

  return (
    <Container className="py-8">
      {venue.is_hidden ? <Alert tone="warning" className="mb-4" title={t("hidden")}>{venue.hidden_reason}</Alert> : null}
      <div className="reveal relative mb-6 aspect-[21/8] overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface-3">
        {cover ? <StorageImage src={cover} alt={venue.name} fill priority sizes="100vw" className="object-cover" fallback={<div className="pitch-lines size-full" />} /> : <div className="pitch-lines size-full" />}
      </div>
      <div className="reveal-children mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-2">
          <h1 className="page-title font-display text-3xl font-bold sm:text-4xl">
            <span className="inline-flex items-center gap-2">
              {venue.name}
              {venue.verification_status === "verified" ? <BadgeCheck aria-label={v("verified")} className="size-6 text-accent" /> : null}
            </span>
          </h1>
          <p className="text-muted">{[venue.address, localizedName(venue.area, locale), localizedName(venue.city, locale)].filter(Boolean).join("، ")}</p>
          <div className="flex flex-wrap gap-1.5">
            {bookable ? <Badge tone="accent">{v("bookable")}</Badge> : <Badge>{v("notBookableYet")}</Badge>}
            {venue.verification_status !== "verified" ? <Badge tone="warning">{t(`verification.${venue.verification_status}`)}</Badge> : null}
            {r.average != null ? <Badge tone="success">★ {r.average} ({r.count})</Badge> : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {staff ? (
            <LinkButton href={`/manage/venues/${id}`} className={buttonClass("secondary", "md")}>
              <Settings aria-hidden="true" className="size-4" />
              {t("manage")}
            </LinkButton>
          ) : user?.isModerator ? (
            // The platform's admins and moderators handle this venue's bookings like its staff.
            <LinkButton href={{ pathname: `/manage/venues/${id}`, query: { tab: "bookings" } }} className={buttonClass("secondary", "md")}>
              <Settings aria-hidden="true" className="size-4" />
              {t("manageBookings")}
            </LinkButton>
          ) : null}
          {bookable ? (
            <LinkButton href={`/venues/${id}/book`} className={buttonClass("primary", "md")}>
              <CalendarCheck aria-hidden="true" className="size-4" />
              {t("book")}
            </LinkButton>
          ) : null}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="flex flex-col gap-8">
          {!bookable ? (
            <Alert tone="info" title={t("notBookableTitle")}>{t("notBookableBody")}</Alert>
          ) : null}
          {venue.description ? <p className="whitespace-pre-line text-muted">{venue.description}</p> : null}

          {/* One court: its price and details, with no name. Several: each court by name. */}
          <Section title={fields.length > 1 ? t("fields") : t("court")} id="fields">
            {fields.length === 0 ? <p className="text-sm text-muted">{t("noFields")}</p> : null}
            <div className="grid gap-3 sm:grid-cols-2">
              {fields.map((f) => (
                <Card key={f.id}>
                  <CardBody className="flex flex-col gap-2">
                    <div className="flex items-center justify-between gap-2">
                      {fields.length > 1 ? <h3 className="font-semibold">{f.name}</h3> : <span className="sr-only">{f.name}</span>}
                      <span className="num font-display font-bold">{t("perHour", { price: formatMoney(f.price_per_hour, venue.city?.currency ?? "IQD", locale) })}</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <Badge>{t(`surface.${f.surface}`)}</Badge>
                      {f.formats.map((x) => <Badge key={x}>{x}</Badge>)}
                      {f.is_covered ? <Badge tone="info">{t("covered")}</Badge> : null}
                      {f.has_lights ? <Badge tone="info">{t("lights")}</Badge> : null}
                    </div>
                    {(f.rules ?? []).length > 0 ? (
                      <ul className="text-xs text-muted">
                        {f.rules!.map((rule) => (
                          <li key={rule.id} className="num" dir="auto">
                            {rule.weekdays.map(dayName).join("، ")} {rule.start_time.slice(0, 5)}–{rule.end_time.slice(0, 5)}:{" "}
                            {formatMoney(rule.price_per_hour, venue.city?.currency ?? "IQD", locale)}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </CardBody>
                </Card>
              ))}
            </div>
          </Section>

          {(venue.images ?? []).length > 0 ? (
            <Section title={t("photos")} id="photos">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {venue.images!.map((img) => (
                  <div key={img.id} className="relative aspect-[4/3] overflow-hidden rounded-xl border border-line">
                    <StorageImage src={publicStorageUrl("venue-images", img.path)!} alt="" fill sizes="33vw" className="object-cover" fallback={<div className="pitch-lines size-full" />} />
                  </div>
                ))}
              </div>
            </Section>
          ) : null}

          <Section title={t("upcomingMatches")} id="matches">
            {(matches ?? []).length === 0 ? (
              <p className="text-sm text-muted">{t("noMatches")}</p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                {((matches ?? []) as unknown as MatchCardData[]).map((m) => <MatchCard key={m.id} match={m} />)}
              </div>
            )}
          </Section>

          <Section title={t("reviews", { count: r.count })} id="reviews">
            {(reviews ?? []).length === 0 ? <p className="text-sm text-muted">{t("noReviews")}</p> : null}
            <ul className="flex flex-col gap-3">
              {(reviews ?? []).map((rv) => (
                <li key={rv.id} className="flex flex-col gap-1 rounded-xl border border-line p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-accent" aria-label={t("stars", { count: rv.venue_rating ?? 0 })}>{"★".repeat(rv.venue_rating ?? 0)}</span>
                    <span className="flex items-center gap-1 text-xs text-faint">
                      {formatDate(rv.created_at, locale, tz)}
                      {user ? <ReportButton targetType="review" targetId={rv.id} compact /> : null}
                    </span>
                  </div>
                  {rv.comment ? <p className="text-sm">{rv.comment}</p> : null}
                </li>
              ))}
            </ul>
          </Section>
        </div>

        <aside className="flex flex-col gap-4">
          {/* Where the venue is. Its phone and WhatsApp aren't shown: bookings happen in the site,
              and a customer reaches the venue from their booking's conversation. */}
          {point || mapUrl ? (
            <Card>
              <CardBody className="flex flex-col gap-3">
                <h2 className="font-display text-lg font-semibold">{t("placeTitle")}</h2>
                {point ? (
                  <ExternalLinkButton href={provider.directionsUrl(point)} className={buttonClass("outline", "sm")}>{t("directions")}</ExternalLinkButton>
                ) : null}
                {mapUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={mapUrl} alt={t("mapAlt", { name: venue.name })} className="rounded-xl border border-line" loading="lazy" />
                ) : null}
              </CardBody>
            </Card>
          ) : null}
          <Card>
            <CardBody className="flex flex-col gap-3">
              <h2 className="font-display text-lg font-semibold">{t("hours")}</h2>
              <OpeningHours hours={venue.hours ?? []} timeZone={venue.city?.timezone ?? "Asia/Baghdad"} />
            </CardBody>
          </Card>
          {venue.facilities.length > 0 ? (
            <Card>
              <CardBody className="flex flex-col gap-3">
                <h2 className="font-display text-lg font-semibold">{t("facilities")}</h2>
                <div className="flex flex-wrap gap-1.5">
                  {venue.facilities.map((f) => <Badge key={f}>{t(`facility.${f}`)}</Badge>)}
                </div>
              </CardBody>
            </Card>
          ) : null}
          {bookable ? (
            <Card>
              <CardBody className="flex flex-col gap-2 text-sm text-muted">
                <h2 className="font-display text-lg font-semibold text-ink">{t("policies")}</h2>
                {deposits.on ? (
                  <p>{t("depositPolicy", { amount: formatMoney(deposits.amount, venue.city?.currency ?? "IQD", locale), minutes: deposits.holdMinutes })}</p>
                ) : null}
                <p>{t(deposits.on ? "cancellationDeadlineDeposit" : "cancellationDeadline", { hours: venue.cancellation_deadline_hours })}</p>
                {venue.cancellation_policy ? <p className="whitespace-pre-line">{venue.cancellation_policy}</p> : null}
                {deposits.on ? null : <p>{venue.auto_confirm_bookings ? t("autoConfirm") : t("manualConfirm")}</p>}
              </CardBody>
            </Card>
          ) : null}
          {user && !staff ? <ReportButton targetType="venue" targetId={id} /> : null}
        </aside>
      </div>
    </Container>
  );
}
