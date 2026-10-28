import { ArrowDown, ArrowLeft, ArrowRight } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getCurrentUser } from "@/lib/auth";
import { heroMedia } from "@/lib/hero-media";
import { openSlots } from "@/lib/domain/match";
import { localizedName } from "@/server/reference";
import { searchMatches, type MatchCardData } from "@/server/matches/queries";
import { HeroBackdrop, HeroVideoControl, HeroVideoProvider } from "@/components/landing/hero-backdrop";
import { Container } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";

export default async function LandingPage({ params }: PageProps<"/[locale]">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [t, tl, tn, user] = await Promise.all([
    getTranslations("home"),
    getTranslations("landing"),
    getTranslations("nav"),
    getCurrentUser(),
  ]);
  const { items: upcoming } = await searchMatches({ sort: "relevance", includeFull: false }).catch(() => ({ items: [] as MatchCardData[] }));
  const media = heroMedia();
  const Forward = locale === "ar" ? ArrowLeft : ArrowRight;

  const steps = [
    { title: tl("how.find.title"), body: tl("how.find.body") },
    { title: tl("how.join.title"), body: tl("how.join.body") },
    { title: tl("how.play.title"), body: tl("how.play.body") },
  ];
  const index = [
    { href: "/teams" as const, title: tl("tiles.teams.title"), body: tl("tiles.teams.body") },
    { href: "/opponents" as const, title: t("index.opponentsTitle"), body: tl("community.opponents") },
    { href: "/venues" as const, title: tl("tiles.venues.title"), body: tl("tiles.venues.body") },
    { href: "/tournaments" as const, title: tl("tiles.tournaments.title"), body: tl("tiles.tournaments.body") },
  ];

  return (
    <>
      {/* ------------------------------------------------------------------
          Hero: full-bleed footage under a floating header, graded in layers.
          ------------------------------------------------------------------ */}
      <HeroVideoProvider media={media}>
        <section className="hero relative isolate -mt-16 flex min-h-[max(40rem,100svh)] flex-col overflow-hidden" aria-labelledby="hero-title">
          <HeroBackdrop media={media} />
          <div aria-hidden="true" className="hero-grade pointer-events-none absolute inset-0" />

          <Container className="relative z-10 mt-auto flex flex-col gap-7 pb-40 pt-32 md:pb-28">
            <p className="hero-in flex items-center gap-3 text-[13px] font-semibold text-accent [--d:150ms]">
              <span aria-hidden="true" className="h-px w-10 bg-accent" />
              {t("hero.kicker")}
            </p>
            <h1 id="hero-title" className="hero-title font-display text-ink">
              {(["line1", "line2", "line3"] as const).map((k, i) => (
                <span key={k} className="hero-line block overflow-hidden pb-[0.08em]">
                  <span className={cn("hero-line-inner block", i === 2 && "text-accent")} style={{ "--d": `${260 + i * 110}ms` } as React.CSSProperties}>
                    {t(`hero.${k}`)}
                  </span>
                </span>
              ))}
            </h1>
            <p className="hero-in max-w-[34ch] text-[clamp(1rem,1.35vw,1.2rem)] leading-relaxed text-ink/80 [--d:720ms]">{t("hero.subtitle")}</p>
            <div className="hero-in flex flex-wrap items-center gap-x-7 gap-y-4 [--d:860ms]">
              <Link href="/matches" className="cta-primary group">
                {t("hero.primary")}
                <Forward aria-hidden="true" className="size-[18px] transition-transform duration-300 group-hover:translate-x-[var(--nudge)]" />
              </Link>
              <Link href="/venues" className="cta-secondary">
                {t("hero.secondary")}
              </Link>
            </div>
          </Container>

          <div className="hero-in absolute inset-x-0 bottom-16 z-10 [--d:1100ms] md:bottom-0">
            <Container className="flex items-end justify-between gap-6 pb-7 text-xs text-ink/60">
              <div className="hidden items-center gap-3 md:flex">
                <ArrowDown aria-hidden="true" className="hero-scroll size-4 text-accent" />
                <span>{t("hero.scroll")}</span>
              </div>
              <div className="ms-auto flex items-end gap-4">
                <div className="flex flex-col items-start gap-1 md:items-end">
                  {upcoming.length > 0 ? (
                    <Link href="/matches" className="font-medium text-ink/85 underline-offset-4 hover:text-accent hover:underline">
                      <span aria-hidden="true" className="me-2 inline-block size-1.5 rounded-full bg-accent align-middle" />
                      {t("hero.openNow", { count: upcoming.length })}
                    </Link>
                  ) : null}
                  <span className="num hidden sm:inline" dir="ltr">{t("hero.coords")}</span>
                  {media.credit ? (
                    <span>
                      {t("hero.footage")} {media.credit}
                    </span>
                  ) : null}
                </div>
                <HeroVideoControl />
              </div>
            </Container>
          </div>
        </section>
      </HeroVideoProvider>

      {/* ------------------------------------------------------------------
          Matchday board: real upcoming matches.
          ------------------------------------------------------------------ */}
      <section className="relative py-20 sm:py-28" aria-labelledby="fixtures-title">
        <Container className="flex flex-col gap-10">
          <header className="grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
            <div className="flex flex-col gap-3">
              <p className="eyebrow">{t("fixtures.eyebrow")}</p>
              <h2 id="fixtures-title" className="section-title">{t("fixtures.title")}</h2>
              <p className="max-w-[46ch] text-muted">{tl("upcoming.subtitle")}</p>
            </div>
            <Link href="/matches" className="link-arrow group self-start md:self-end">
              {tl("upcoming.all")}
              <Forward aria-hidden="true" className="size-4 transition-transform duration-300 group-hover:translate-x-[var(--nudge)]" />
            </Link>
          </header>

          {upcoming.length > 0 ? (
            <ol className="border-t border-line">
              {upcoming.slice(0, 5).map((m) => (
                <FixtureRow key={m.id} match={m} locale={locale} t={t} Forward={Forward} />
              ))}
            </ol>
          ) : (
            <div className="flex flex-col items-start gap-5 border-y border-line py-12">
              <p className="font-display text-2xl font-bold">{tl("upcoming.emptyTitle")}</p>
              <p className="max-w-[46ch] text-muted">{tl("upcoming.emptyBody")}</p>
              <Link href={user ? "/matches/new" : "/sign-up"} className="cta-primary">
                {tl("upcoming.emptyAction")}
              </Link>
            </div>
          )}
        </Container>
      </section>

      {/* ------------------------------------------------------------------
          How it works: editorial split with large numerals.
          ------------------------------------------------------------------ */}
      <section className="border-y border-line bg-surface/40 py-20 sm:py-28" aria-labelledby="how-title">
        <Container className="grid gap-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-20">
          <div className="flex flex-col gap-4 lg:sticky lg:top-28 lg:self-start">
            <p className="eyebrow">{t("how.eyebrow")}</p>
            <h2 id="how-title" className="section-title max-w-[16ch]">{t("how.title")}</h2>
          </div>
          <ol className="flex flex-col">
            {steps.map((s, i) => (
              <li key={s.title} className="grid grid-cols-[4.5rem_1fr] gap-x-6 border-t border-line py-8 first:border-t-0 first:pt-0 sm:grid-cols-[6rem_1fr]">
                <span aria-hidden="true" className="step-numeral num">{String(i + 1).padStart(2, "0")}</span>
                <div className="flex flex-col gap-2">
                  <h3 className="font-display text-2xl font-bold">{s.title}</h3>
                  <p className="max-w-[48ch] text-muted">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </Container>
      </section>

      {/* ------------------------------------------------------------------
          Index: the rest of the platform as a typographic directory.
          ------------------------------------------------------------------ */}
      <section className="py-20 sm:py-28" aria-labelledby="index-title">
        <Container className="flex flex-col gap-10">
          <div className="flex flex-col gap-3">
            <p className="eyebrow">{t("index.eyebrow")}</p>
            <h2 id="index-title" className="section-title">{t("index.title")}</h2>
          </div>
          <ul className="border-t border-line">
            {index.map((item) => (
              <li key={item.href} className="border-b border-line">
                <Link href={item.href} className="index-link group grid items-baseline gap-x-8 gap-y-2 py-7 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_auto]">
                  <span className="font-display text-[clamp(1.9rem,4vw,3.25rem)] font-extrabold leading-none transition-colors duration-300 group-hover:text-accent">
                    {item.title}
                  </span>
                  <span className="max-w-[48ch] text-muted">{item.body}</span>
                  <Forward aria-hidden="true" className="hidden size-6 text-faint transition-all duration-300 group-hover:translate-x-[var(--nudge)] group-hover:text-accent sm:block" />
                </Link>
              </li>
            ))}
          </ul>
        </Container>
      </section>

      {/* ------------------------------------------------------------------
          Trust: quiet editorial statement.
          ------------------------------------------------------------------ */}
      <section className="border-t border-line py-20 sm:py-28" aria-labelledby="trust-title">
        <Container className="grid gap-10 lg:grid-cols-2 lg:gap-20">
          <div className="flex flex-col gap-4">
            <p className="eyebrow">{tl("trust.title")}</p>
            <h2 id="trust-title" className="section-title max-w-[14ch]">{t("trust.title")}</h2>
            <Link href="/legal/safety" className="link-arrow group mt-2 self-start">
              {tl("trust.more")}
              <Forward aria-hidden="true" className="size-4 transition-transform duration-300 group-hover:translate-x-[var(--nudge)]" />
            </Link>
          </div>
          <ul className="flex flex-col">
            {(["verified", "reviews", "privacy", "report", "payments"] as const).map((k) => (
              <li key={k} className="flex gap-4 border-t border-line py-5 text-ink/85 first:border-t-0 first:pt-0">
                <span aria-hidden="true" className="mt-[0.7em] h-px w-5 shrink-0 bg-accent" />
                <span>{tl(`trust.${k}`)}</span>
              </li>
            ))}
          </ul>
        </Container>
      </section>

      {/* ------------------------------------------------------------------
          Final call: the centre circle as a quiet motif.
          ------------------------------------------------------------------ */}
      <section className="final-cta relative overflow-hidden border-t border-line" aria-labelledby="final-title">
        <div aria-hidden="true" className="final-pitch pointer-events-none absolute inset-0" />
        <Container className="relative flex flex-col items-start gap-6 py-24 sm:py-32">
          <h2 id="final-title" className="font-display text-[clamp(3rem,8vw,6.5rem)] font-extrabold leading-[0.95]">
            {t("final.title")}
          </h2>
          <p className="max-w-[38ch] text-lg text-ink/80">{t("final.body")}</p>
          <div className="flex flex-wrap items-center gap-x-7 gap-y-4">
            <Link href={user ? "/matches/new" : "/sign-up"} className="cta-primary group">
              {user ? tl("hero.createMatch") : tl("hero.join")}
              <Forward aria-hidden="true" className="size-[18px] transition-transform duration-300 group-hover:translate-x-[var(--nudge)]" />
            </Link>
            <Link href="/matches" className="cta-secondary">
              {tn("matches")}
            </Link>
          </div>
        </Container>
      </section>
    </>
  );
}

function FixtureRow({
  match,
  locale,
  t,
  Forward,
}: {
  match: MatchCardData;
  locale: string;
  t: Awaited<ReturnType<typeof getTranslations<"home">>>;
  Forward: typeof ArrowLeft;
}) {
  const tz = match.city?.timezone ?? "Asia/Baghdad";
  const start = new Date(match.starts_at);
  const fmt = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(locale === "ar" ? "ar-IQ" : "en-GB", { timeZone: tz, ...o }).format(start);
  const slots = openSlots(match);
  const place = match.venue?.name ?? localizedName(match.area, locale) ?? localizedName(match.city, locale);
  const teams = match.home_team && match.away_team ? `${match.home_team.name} ${t("fixtures.vs")} ${match.away_team.name}` : null;
  return (
    <li className="border-b border-line">
      <Link
        href={`/matches/${match.id}`}
        className="fixture-row group grid grid-cols-[4.75rem_1fr_auto] items-center gap-x-5 gap-y-1 py-6 sm:grid-cols-[7rem_1fr_auto_auto] sm:gap-x-8"
      >
        <span className="flex flex-col leading-tight">
          <span className="text-xs font-semibold text-muted">{fmt({ weekday: "short", day: "numeric", month: "short" })}</span>
          <span className="num font-display text-2xl font-bold sm:text-3xl">{fmt({ hour: "numeric", minute: "2-digit" })}</span>
        </span>
        <span className="flex min-w-0 flex-col gap-1">
          <span className="truncate font-display text-lg font-bold transition-colors duration-300 group-hover:text-accent sm:text-xl">{teams ?? match.title}</span>
          <span className="truncate text-sm text-muted">
            {place}
            <span className="mx-2 text-faint">·</span>
            <span dir="ltr">{match.format}</span>
          </span>
        </span>
        <span className={cn("hidden whitespace-nowrap text-sm font-semibold sm:block", slots > 0 ? "text-accent" : "text-warning")}>
          {slots > 0 ? t("fixtures.spotsLeft", { count: slots }) : t("fixtures.waitlist")}
        </span>
        <Forward aria-hidden="true" className="size-5 text-faint transition-all duration-300 group-hover:translate-x-[var(--nudge)] group-hover:text-accent" />
        <span className={cn("col-start-2 text-xs font-semibold sm:hidden", slots > 0 ? "text-accent" : "text-warning")}>
          {slots > 0 ? t("fixtures.spotsLeft", { count: slots }) : t("fixtures.waitlist")}
        </span>
      </Link>
    </li>
  );
}
