import { ArrowLeft, ArrowRight, BadgeCheck } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getCurrentUser } from "@/lib/auth";
import { POSITIONS, openSlots } from "@/lib/domain/match";
import { formatMoney } from "@/lib/domain/money";
import { acceptsPlatformBookings } from "@/lib/domain/venue";
import { formatDate } from "@/lib/format";
import { localizedName } from "@/server/reference";
import { currentTournaments, teamsRecruitingByPosition } from "@/server/landing";
import { searchMatches, type MatchCardData } from "@/server/matches/queries";
import { listVenues, type VenueCardData } from "@/server/venues/queries";
import { StageHost } from "@/components/stage/stage-host";
import { Container } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";

type Translator = Awaited<ReturnType<typeof getTranslations>>;

/**
 * The landing page: six scenes over a live floodlit stadium (WebGL, with a
 * still-image fallback). Every figure on it comes from the database — open
 * matches, recruiting teams, venues, tournaments — and every action leads to
 * the real flow behind it.
 */
export default async function LandingPage({ params }: PageProps<"/[locale]">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [t, tm, te, tt, tv, user] = await Promise.all([
    getTranslations("home"),
    getTranslations("match"),
    getTranslations("enums"),
    getTranslations("tournament"),
    getTranslations("venues"),
    getCurrentUser(),
  ]);
  const [matches, recruiting, venues, tournaments] = await Promise.all([
    searchMatches({ sort: "relevance", includeFull: false })
      .then((r) => r.items)
      .catch(() => [] as MatchCardData[]),
    teamsRecruitingByPosition().catch(() => null),
    listVenues({ page: 1 })
      .then((r) => r.items)
      .catch(() => [] as VenueCardData[]),
    currentTournaments(3).catch(() => [] as Awaited<ReturnType<typeof currentTournaments>>),
  ]);

  const Forward = locale === "ar" ? ArrowLeft : ArrowRight;
  const chapter = (n: number) => new Intl.NumberFormat(locale === "ar" ? "ar-IQ" : "en-GB", { minimumIntegerDigits: 2 }).format(n);
  const recruitingText = (count: number | undefined) =>
    count === undefined ? "" : count > 0 ? t("squad.teamsLooking", { count }) : t("squad.noRequests");
  const markers = POSITIONS.map((position) => {
    const count = recruiting?.[position];
    return {
      position,
      title: te(`position.${position}`),
      detail: count === undefined ? "" : count > 0 ? t("squad.teamsLooking", { count }) : t("squad.markerNone"),
    };
  });

  return (
    <>
      <StageHost
        markers={markers}
        labels={{
          controls: t("stage.controls"),
          skip: t("stage.skip"),
          soundOn: t("stage.soundOn"),
          soundOff: t("stage.soundOff"),
          motionPause: t("stage.motionPause"),
          motionPlay: t("stage.motionPlay"),
          resetBall: t("stage.resetBall"),
          kick: t("stage.kick"),
          kickHint: t("stage.kickHint"),
        }}
      >
        {/* ------------------------------------------------------------------
            01 — The pitch: the opening shot and the two main actions.
            ------------------------------------------------------------------ */}
        <section data-scene="pitch" className="stage-scene scene-hero" aria-labelledby="hero-title">
          <Container className="flex flex-col gap-6 sm:gap-7">
            <p className="scene-kicker intro-reveal" style={{ "--d": "0ms" } as React.CSSProperties}>
              {t("hero.kicker")}
            </p>
            <h1 id="hero-title" className="hero-title font-display text-ink">
              <span className="reveal-line">
                <span style={{ "--d": "90ms" } as React.CSSProperties}>{t("hero.line1")}</span>
              </span>{" "}
              <span className="reveal-line">
                <span className="text-accent" style={{ "--d": "210ms" } as React.CSSProperties}>
                  {t("hero.line2")}
                </span>
              </span>
            </h1>
            <p className="hero-sub intro-reveal" style={{ "--d": "520ms" } as React.CSSProperties}>
              {t("hero.subtitle")}
            </p>
            <div className="stage-panel intro-reveal flex flex-wrap items-center gap-x-7 gap-y-4" style={{ "--d": "680ms" } as React.CSSProperties}>
              <Link href="/matches" className="cta-primary group">
                {t("hero.primary")}
                <Forward aria-hidden="true" className="size-[18px] transition-transform duration-300 group-hover:translate-x-[var(--nudge)]" />
              </Link>
              <Link href={{ pathname: "/venues", query: { bookable: "1" } }} className="cta-secondary">
                {t("hero.secondary")}
              </Link>
            </div>
          </Container>
          <div className="hero-strip intro-reveal" style={{ "--d": "900ms" } as React.CSSProperties}>
            <Container className="flex items-end justify-between gap-6 text-xs text-ink/65">
              <span className="hidden items-center gap-3 md:flex">
                <span aria-hidden="true" className="scroll-cue" />
                {t("hero.scroll")}
              </span>
              <span className="stage-panel ms-auto flex flex-col items-start gap-1 md:items-end">
                {matches.length > 0 ? (
                  <Link href="/matches" className="font-medium text-ink/90 underline-offset-4 hover:text-accent hover:underline">
                    <span aria-hidden="true" className="me-2 inline-block size-1.5 rounded-full bg-accent align-middle" />
                    {t("hero.openNow", { count: matches.length })}
                  </Link>
                ) : null}
                <span className="num hidden sm:inline" dir="ltr">
                  {t("hero.coords")}
                </span>
              </span>
            </Container>
          </div>
        </section>

        {/* ------------------------------------------------------------------
            02 — Find your game: real open matches.
            ------------------------------------------------------------------ */}
        <section data-scene="matches" className="stage-scene" aria-labelledby="matches-title">
          <Container>
            <div className="scene-panel">
              <SceneHeading number={chapter(2)} chapterLabel={t("matches.chapter")} id="matches-title" title={t("matches.title")} body={t("matches.body")} />
              {matches.length > 0 ? (
                <ol className="scene-board">
                  {matches.slice(0, 4).map((m) => (
                    <MatchRow key={m.id} match={m} locale={locale} t={t} tm={tm} Forward={Forward} />
                  ))}
                </ol>
              ) : (
                <EmptyBoard title={t("matches.emptyTitle")} body={t("matches.emptyBody")}>
                  <Link href={user ? "/matches/new" : "/sign-up"} className="cta-primary">
                    {t("matches.emptyAction")}
                  </Link>
                </EmptyBoard>
              )}
              <div className="scene-links">
                <Link href="/matches" className="link-arrow group">
                  {t("matches.all")}
                  <Forward aria-hidden="true" className="size-4 transition-transform duration-300 group-hover:translate-x-[var(--nudge)]" />
                </Link>
              </div>
            </div>
          </Container>
        </section>

        {/* ------------------------------------------------------------------
            03 — Build your squad: positions teams are recruiting for.
            ------------------------------------------------------------------ */}
        <section data-scene="squad" className="stage-scene" aria-labelledby="squad-title">
          <Container>
            <div className="scene-panel">
              <SceneHeading number={chapter(3)} chapterLabel={t("squad.chapter")} id="squad-title" title={t("squad.title")} body={t("squad.body")} />
              <ul className="scene-board">
                {POSITIONS.map((p) => (
                  <li key={p}>
                    <Link href={{ pathname: "/recruitment", query: { position: p } }} data-position={p} className="board-row board-link group">
                      <span className="font-display text-lg font-bold transition-colors duration-300 group-hover:text-accent sm:text-xl">{te(`position.${p}`)}</span>
                      <span className={cn("text-sm", (recruiting?.[p] ?? 0) > 0 ? "text-accent" : "text-muted")}>{recruitingText(recruiting?.[p])}</span>
                      <Forward aria-hidden="true" className="size-5 text-faint transition-all duration-300 group-hover:translate-x-[var(--nudge)] group-hover:text-accent" />
                    </Link>
                  </li>
                ))}
              </ul>
              <div className="scene-links">
                <Link href="/teams" className="link-arrow">
                  {t("squad.teams")}
                </Link>
                <Link href="/teams/new" className="link-arrow">
                  {t("squad.createTeam")}
                </Link>
                <Link href="/opponents" className="link-arrow">
                  {t("squad.opponents")}
                </Link>
              </div>
            </div>
          </Container>
        </section>

        {/* ------------------------------------------------------------------
            04 — Your next venue: real pitches and how to book them.
            ------------------------------------------------------------------ */}
        <section data-scene="venues" className="stage-scene" aria-labelledby="venues-title">
          <Container>
            <div className="scene-panel">
              <SceneHeading number={chapter(4)} chapterLabel={t("venues.chapter")} id="venues-title" title={t("venues.title")} body={t("venues.body")} />
              {venues.length > 0 ? (
                <ul className="scene-board">
                  {venues.slice(0, 4).map((v) => (
                    <VenueRow key={v.id} venue={v} locale={locale} t={t} tv={tv} Forward={Forward} />
                  ))}
                </ul>
              ) : (
                <EmptyBoard title={t("venues.emptyTitle")} body={t("venues.emptyBody")}>
                  <Link href="/manage/venues/new" className="cta-primary">
                    {t("venues.list")}
                  </Link>
                </EmptyBoard>
              )}
              <div className="scene-links">
                <Link href="/venues" className="link-arrow group">
                  {t("venues.all")}
                  <Forward aria-hidden="true" className="size-4 transition-transform duration-300 group-hover:translate-x-[var(--nudge)]" />
                </Link>
                {venues.length > 0 ? (
                  <Link href="/manage/venues/new" className="link-arrow">
                    {t("venues.list")}
                  </Link>
                ) : null}
              </div>
            </div>
          </Container>
        </section>

        {/* ------------------------------------------------------------------
            05 — Tournament night: tournaments open or under way.
            ------------------------------------------------------------------ */}
        <section data-scene="tournaments" className="stage-scene" aria-labelledby="tournaments-title">
          <Container>
            <div className="scene-panel">
              <SceneHeading
                number={chapter(5)}
                chapterLabel={t("tournaments.chapter")}
                id="tournaments-title"
                title={t("tournaments.title")}
                body={t("tournaments.body")}
              />
              {tournaments.length > 0 ? (
                <ul className="scene-board">
                  {tournaments.map((r) => {
                    const approved = (r.teams ?? []).filter((x) => x.status === "approved").length;
                    return (
                      <li key={r.id}>
                        <Link href={`/tournaments/${r.id}`} className="board-row board-link group">
                          <span className="flex min-w-0 flex-col gap-1">
                            <span className="truncate font-display text-lg font-bold transition-colors duration-300 group-hover:text-accent sm:text-xl">{r.name}</span>
                            <span className="text-sm text-muted">
                              {localizedName(r.city, locale)} · {formatDate(r.starts_on, locale, "UTC")} – {formatDate(r.ends_on, locale, "UTC")}
                            </span>
                          </span>
                          <span className="flex flex-col items-end gap-1 text-end text-sm">
                            <span className={cn("font-semibold", r.status === "registration_open" ? "text-accent" : "text-ink/85")}>{tt(`status.${r.status}`)}</span>
                            <span className="num text-muted">{tt("teamsCount", { count: approved, capacity: r.team_capacity })}</span>
                          </span>
                          <Forward aria-hidden="true" className="size-5 text-faint transition-all duration-300 group-hover:translate-x-[var(--nudge)] group-hover:text-accent" />
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <EmptyBoard title={t("tournaments.emptyTitle")} body={t("tournaments.emptyBody")}>
                  <Link href="/tournaments/new" className="cta-primary">
                    {t("tournaments.create")}
                  </Link>
                </EmptyBoard>
              )}
              <div className="scene-links">
                <Link href="/tournaments" className="link-arrow group">
                  {t("tournaments.all")}
                  <Forward aria-hidden="true" className="size-4 transition-transform duration-300 group-hover:translate-x-[var(--nudge)]" />
                </Link>
                {tournaments.length > 0 ? (
                  <Link href="/tournaments/new" className="link-arrow">
                    {t("tournaments.create")}
                  </Link>
                ) : null}
              </div>
            </div>
          </Container>
        </section>

        {/* ------------------------------------------------------------------
            06 — The final whistle.
            ------------------------------------------------------------------ */}
        <section data-scene="final" className="stage-scene scene-final" aria-labelledby="final-title">
          <Container>
            <div className="scene-panel">
              <p className="scene-chapter">
                <span className="num">{chapter(6)}</span>
                {t("final.chapter")}
              </p>
              <h2 id="final-title" className="final-title font-display">
                {t("final.title")}
              </h2>
              <div className="flex flex-wrap items-center gap-x-7 gap-y-4">
                <Link href="/matches" className="cta-primary group">
                  {t("final.primary")}
                  <Forward aria-hidden="true" className="size-[18px] transition-transform duration-300 group-hover:translate-x-[var(--nudge)]" />
                </Link>
                <Link href={user ? "/matches/new" : "/sign-up"} className="cta-secondary">
                  {user ? t("final.create") : t("final.join")}
                </Link>
              </div>
              <ul className="trust-list">
                {(["verified", "reviews", "privacy", "payments"] as const).map((k) => (
                  <li key={k}>
                    <span aria-hidden="true" className="mt-[0.7em] h-px w-4 shrink-0 bg-accent" />
                    <span>{t(`final.trust.${k}`)}</span>
                  </li>
                ))}
              </ul>
              <Link href="/legal/safety" className="link-arrow group self-start">
                {t("final.trust.more")}
                <Forward aria-hidden="true" className="size-4 transition-transform duration-300 group-hover:translate-x-[var(--nudge)]" />
              </Link>
            </div>
          </Container>
        </section>
      </StageHost>
    </>
  );
}

function SceneHeading({ number, chapterLabel, id, title, body }: { number: string; chapterLabel: string; id: string; title: string; body: string }) {
  return (
    <header className="flex flex-col gap-3">
      <p className="scene-chapter">
        <span className="num">{number}</span>
        {chapterLabel}
      </p>
      <h2 id={id} className="scene-title">
        {title}
      </h2>
      <p className="max-w-[46ch] text-ink/75">{body}</p>
    </header>
  );
}

function EmptyBoard({ title, body, children }: { title: string; body: string; children: React.ReactNode }) {
  return (
    <div className="scene-board flex flex-col items-start gap-4 py-8">
      <p className="font-display text-2xl font-bold">{title}</p>
      <p className="max-w-[46ch] text-muted">{body}</p>
      {children}
    </div>
  );
}

function MatchRow({ match, locale, t, tm, Forward }: { match: MatchCardData; locale: string; t: Translator; tm: Translator; Forward: typeof ArrowLeft }) {
  const tz = match.city?.timezone ?? "Asia/Baghdad";
  const start = new Date(match.starts_at);
  const fmt = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(locale === "ar" ? "ar-IQ" : "en-GB", { timeZone: tz, ...o }).format(start);
  const slots = openSlots(match);
  const place = match.venue?.name ?? localizedName(match.area, locale) ?? localizedName(match.city, locale);
  const teams = match.home_team && match.away_team ? `${match.home_team.name} ${t("matches.vs")} ${match.away_team.name}` : null;
  const price =
    match.price_per_player > 0 ? (
      <>
        <span className="num font-semibold text-ink">{formatMoney(match.price_per_player, match.currency, locale)}</span>
        <span className="text-xs text-muted">{match.cost_is_estimate ? tm("perPlayerEstimate") : tm("perPlayer")}</span>
      </>
    ) : (
      <span className="font-semibold text-accent">{tm("free")}</span>
    );
  return (
    <li>
      <div className="board-row match-row group">
        <time dateTime={match.starts_at} className="flex flex-col leading-tight">
          <span className="text-xs font-semibold text-muted">{fmt({ weekday: "short", day: "numeric", month: "short" })}</span>
          <span className="num font-display text-2xl font-bold">{fmt({ hour: "numeric", minute: "2-digit" })}</span>
        </time>
        <span className="flex min-w-0 flex-col gap-1">
          <Link href={`/matches/${match.id}`} className="board-stretch truncate font-display text-lg font-bold transition-colors duration-300 group-hover:text-accent sm:text-xl">
            {teams ?? match.title}
          </Link>
          <span className="truncate text-sm text-muted">
            {place}
            <span className="mx-2 text-faint">·</span>
            <span dir="ltr">{match.format}</span>
          </span>
        </span>
        <span className="match-meta flex flex-col items-end gap-0.5 text-end text-sm">
          <span className={cn("font-semibold", slots > 0 ? "text-accent" : "text-warning")}>
            {slots > 0 ? t("matches.spotsLeft", { count: slots }) : t("matches.waitlist")}
          </span>
          <span className="flex flex-col items-end">{price}</span>
        </span>
        <span aria-hidden="true" className="match-join">
          {t("matches.join")}
          <Forward className="size-4 transition-transform duration-300 group-hover:translate-x-[var(--nudge)]" />
        </span>
      </div>
    </li>
  );
}

function VenueRow({ venue, locale, t, tv, Forward }: { venue: VenueCardData; locale: string; t: Translator; tv: Translator; Forward: typeof ArrowLeft }) {
  const active = venue.fields.filter((f) => f.is_active);
  const minPrice = active.length ? Math.min(...active.map((f) => f.price_per_hour)) : null;
  const bookable = acceptsPlatformBookings(venue);
  return (
    <li>
      <Link href={`/venues/${venue.id}`} className="board-row board-link group">
        <span className="flex min-w-0 flex-col gap-1">
          <span className="flex items-center gap-1.5 truncate font-display text-lg font-bold transition-colors duration-300 group-hover:text-accent sm:text-xl">
            {venue.name}
            {venue.verification_status === "verified" ? <BadgeCheck aria-label={tv("verified")} className="size-4 shrink-0 text-accent" /> : null}
          </span>
          <span className="truncate text-sm text-muted">{[localizedName(venue.area, locale), localizedName(venue.city, locale)].filter(Boolean).join("، ")}</span>
        </span>
        <span className="flex flex-col items-end gap-0.5 text-end text-sm">
          <span className={cn("font-semibold", bookable ? "text-accent" : "text-ink/80")}>{bookable ? tv("bookable") : tv("contactOnly")}</span>
          {minPrice != null ? <span className="num text-muted">{tv("fromPrice", { price: formatMoney(minPrice, "IQD", locale) })}</span> : null}
        </span>
        <span className="match-join">
          {bookable ? t("venues.book") : t("venues.view")}
          <Forward aria-hidden="true" className="size-4 transition-transform duration-300 group-hover:translate-x-[var(--nudge)]" />
        </span>
      </Link>
    </li>
  );
}
