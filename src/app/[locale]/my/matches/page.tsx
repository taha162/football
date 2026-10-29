import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { requireOnboardedUser } from "@/lib/auth";
import { getMyMatches } from "@/server/matches/queries";
import { MatchCard } from "@/components/match/match-card";
import { buttonClass } from "@/components/ui/button";
import { Container, EmptyState, PageHeader } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { LinkButton } from "@/components/ui/link-button";

export default async function MyMatchesPage({ params, searchParams }: PageProps<"/[locale]/my/matches">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireOnboardedUser(locale as Locale, "/my/matches");
  const tab = (await searchParams).tab === "past" ? "past" : "upcoming";
  const t = await getTranslations("myMatches");
  const matches = await getMyMatches(user.id, tab);
  return (
    <Container className="py-10">
      <PageHeader title={t("title")} actions={<LinkButton href="/matches/new" className={buttonClass("primary", "md")}>{t("create")}</LinkButton>} />
      <nav aria-label={t("tabs")} className="mb-6 flex gap-2">
        {(["upcoming", "past"] as const).map((k) => (
          <LinkButton
            key={k}
            href={{ pathname: "/my/matches", query: k === "past" ? { tab: "past" } : {} }}
            aria-current={tab === k ? "page" : undefined}
            className={cn(buttonClass(tab === k ? "secondary" : "ghost", "sm"))}
          >
            {t(k)}
          </LinkButton>
        ))}
      </nav>
      {matches.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {matches.map((m) => (
            <MatchCard key={m.id} match={m} role={m.role} />
          ))}
        </div>
      ) : (
        <EmptyState title={tab === "past" ? t("emptyPast") : t("emptyUpcoming")} action={<LinkButton href="/matches" className={buttonClass("primary", "md")}>{t("find")}</LinkButton>} />
      )}
    </Container>
  );
}
