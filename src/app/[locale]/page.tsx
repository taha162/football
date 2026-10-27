import { ArrowLeft, ArrowRight, CalendarSearch, Flag, MapPinned, ShieldCheck, Swords, Trophy, Users } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getCurrentUser } from "@/lib/auth";
import { searchMatches } from "@/server/matches/queries";
import { MatchCard } from "@/components/match/match-card";
import { buttonClass } from "@/components/ui/button";
import { Container, EmptyState } from "@/components/ui/primitives";

export default async function LandingPage({ params }: PageProps<"/[locale]">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("landing");
  const user = await getCurrentUser();
  const { items: upcoming } = await searchMatches({ sort: "relevance", includeFull: false }).catch(() => ({ items: [] }));
  const Arrow = locale === "ar" ? ArrowLeft : ArrowRight;

  const steps = [
    { icon: CalendarSearch, title: t("how.find.title"), body: t("how.find.body") },
    { icon: Users, title: t("how.join.title"), body: t("how.join.body") },
    { icon: Flag, title: t("how.play.title"), body: t("how.play.body") },
  ];

  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-line">
        <div aria-hidden="true" className="pitch-lines absolute inset-0 opacity-70 [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)]" />
        <Container className="relative flex flex-col items-start gap-6 py-16 sm:py-24">
          <p className="rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-xs font-semibold text-accent">{t("hero.eyebrow")}</p>
          <h1 className="max-w-3xl font-display text-5xl font-extrabold leading-[1.05] tracking-tight sm:text-7xl">
            {t("hero.titleA")} <span className="text-accent">{t("hero.titleB")}</span>
          </h1>
          <p className="max-w-xl text-lg text-muted">{t("hero.subtitle")}</p>
          <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
            <Link href="/matches" className={buttonClass("primary", "lg", "w-full sm:w-auto")}>
              {t("hero.findMatch")}
              <Arrow aria-hidden="true" className="size-4" />
            </Link>
            <Link href={user ? "/matches/new" : "/sign-up"} className={buttonClass("outline", "lg", "w-full sm:w-auto")}>
              {user ? t("hero.createMatch") : t("hero.join")}
            </Link>
          </div>
        </Container>
      </section>

      {/* Upcoming matches (real data) */}
      <Container className="flex flex-col gap-6 py-14">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 className="font-display text-3xl font-bold">{t("upcoming.title")}</h2>
            <p className="text-muted">{t("upcoming.subtitle")}</p>
          </div>
          <Link href="/matches" className={buttonClass("ghost", "sm")}>
            {t("upcoming.all")}
          </Link>
        </div>
        {upcoming.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {upcoming.slice(0, 6).map((m) => (
              <MatchCard key={m.id} match={m} />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<CalendarSearch className="size-10" />}
            title={t("upcoming.emptyTitle")}
            action={
              <Link href={user ? "/matches/new" : "/sign-up"} className={buttonClass("primary", "md")}>
                {t("upcoming.emptyAction")}
              </Link>
            }
          >
            {t("upcoming.emptyBody")}
          </EmptyState>
        )}
      </Container>

      {/* How it works */}
      <section className="border-y border-line bg-surface/50">
        <Container className="flex flex-col gap-8 py-14">
          <h2 className="font-display text-3xl font-bold">{t("how.title")}</h2>
          <ol className="grid gap-4 md:grid-cols-3">
            {steps.map((s, i) => (
              <li key={s.title} className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-5">
                <span className="flex items-center gap-3">
                  <span className="num flex size-9 items-center justify-center rounded-xl bg-accent font-display text-lg font-bold text-accent-ink">{i + 1}</span>
                  <s.icon aria-hidden="true" className="size-5 text-accent" />
                </span>
                <h3 className="font-display text-xl font-semibold">{s.title}</h3>
                <p className="text-sm text-muted">{s.body}</p>
              </li>
            ))}
          </ol>
        </Container>
      </section>

      {/* Discovery tiles */}
      <Container className="grid gap-4 py-14 md:grid-cols-3">
        <Tile href="/teams" icon={<Users className="size-6" />} title={t("tiles.teams.title")} body={t("tiles.teams.body")} cta={t("tiles.teams.cta")} />
        <Tile href="/venues" icon={<MapPinned className="size-6" />} title={t("tiles.venues.title")} body={t("tiles.venues.body")} cta={t("tiles.venues.cta")} />
        <Tile href="/tournaments" icon={<Trophy className="size-6" />} title={t("tiles.tournaments.title")} body={t("tiles.tournaments.body")} cta={t("tiles.tournaments.cta")} />
      </Container>

      {/* Community & trust */}
      <section className="border-t border-line">
        <Container className="grid gap-10 py-14 md:grid-cols-2">
          <div className="flex flex-col gap-4">
            <h2 className="font-display text-3xl font-bold">{t("community.title")}</h2>
            <ul className="flex flex-col gap-3 text-muted">
              {(["missing", "opponents", "organize", "cost"] as const).map((k) => (
                <li key={k} className="flex gap-3">
                  <Swords aria-hidden="true" className="mt-1 size-4 shrink-0 text-accent" />
                  <span>{t(`community.${k}`)}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="flex flex-col gap-4 rounded-[var(--radius-card)] border border-line bg-surface p-6">
            <h2 className="flex items-center gap-2 font-display text-2xl font-bold">
              <ShieldCheck aria-hidden="true" className="size-6 text-accent" />
              {t("trust.title")}
            </h2>
            <ul className="flex list-disc flex-col gap-2 ps-5 text-sm text-muted">
              {(["privacy", "verified", "reviews", "report", "payments"] as const).map((k) => (
                <li key={k}>{t(`trust.${k}`)}</li>
              ))}
            </ul>
            <Link href="/legal/safety" className={buttonClass("outline", "sm", "self-start")}>
              {t("trust.more")}
            </Link>
          </div>
        </Container>
      </section>
    </>
  );
}

function Tile({ href, icon, title, body, cta }: { href: "/teams" | "/venues" | "/tournaments"; icon: React.ReactNode; title: string; body: string; cta: string }) {
  return (
    <Link href={href} className="group flex flex-col gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-6 transition-colors hover:border-accent/50">
      <span className="text-accent" aria-hidden="true">{icon}</span>
      <h3 className="font-display text-xl font-semibold">{title}</h3>
      <p className="text-sm text-muted">{body}</p>
      <span className="mt-auto text-sm font-semibold text-accent group-hover:underline">{cta}</span>
    </Link>
  );
}
