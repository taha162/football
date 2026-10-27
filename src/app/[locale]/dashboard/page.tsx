import type { Metadata } from "next";
import { CalendarPlus, MapPinned, Swords, Users } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { Link } from "@/i18n/navigation";
import { requireOnboardedUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getMyMatches, searchMatches } from "@/server/matches/queries";
import { respondMatchInvitationAction } from "@/server/matches/actions";
import { respondTeamInvitationAction } from "@/server/teams/actions";
import { MatchCard } from "@/components/match/match-card";
import { ActionForm, Hidden, SubmitButton } from "@/components/ui/action-form";
import { buttonClass } from "@/components/ui/button";
import { Card, CardBody, Container, EmptyState, PageHeader, Section } from "@/components/ui/primitives";

export async function generateMetadata({ params }: PageProps<"/[locale]/dashboard">): Promise<Metadata> {
  const t = await getTranslations({ locale: (await params).locale, namespace: "dashboard" });
  return { title: t("title") };
}

export default async function DashboardPage({ params }: PageProps<"/[locale]/dashboard">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireOnboardedUser(locale as Locale, "/dashboard");
  const t = await getTranslations("dashboard");
  const supabase = await createClient();
  const [upcoming, recommended, { data: matchInvites }, { data: teamInvites }, { data: venues }] = await Promise.all([
    getMyMatches(user.id, "upcoming"),
    searchMatches({ city: user.profile.city_id ?? undefined, sort: "relevance", includeFull: false, skill: undefined }),
    supabase.from("match_invitations").select("id, match:matches(id, title, starts_at)").eq("invitee_id", user.id).eq("status", "pending"),
    supabase.from("team_invitations").select("id, team:teams(id, name)").eq("invitee_id", user.id).eq("status", "pending"),
    supabase.from("venue_staff").select("venue:venues(id, name)").eq("user_id", user.id),
  ]);
  const mineIds = new Set(upcoming.map((m) => m.id));
  const suggestions = recommended.items.filter((m) => !mineIds.has(m.id)).slice(0, 4);
  let pendingBookings = 0;
  if ((venues ?? []).length > 0) {
    const { count } = await supabase
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("status", "requested")
      .in("venue_id", (venues ?? []).flatMap((v) => (v.venue ? [v.venue.id] : [])));
    pendingBookings = count ?? 0;
  }

  const quick = [
    { href: "/matches/new", icon: CalendarPlus, label: t("quick.create") },
    { href: "/matches", icon: Users, label: t("quick.find") },
    { href: "/opponents", icon: Swords, label: t("quick.opponents") },
    { href: "/venues", icon: MapPinned, label: t("quick.venues") },
  ] as const;

  return (
    <Container className="flex flex-col gap-10 py-10">
      <PageHeader eyebrow={t("eyebrow")} title={t("greeting", { name: user.profile.display_name })} />

      <nav aria-label={t("quickActions")} className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {quick.map((q) => (
          <Link key={q.href} href={q.href} className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-line bg-surface p-4 transition-colors hover:border-accent/50">
            <q.icon aria-hidden="true" className="size-5 text-accent" />
            <span className="text-sm font-semibold">{q.label}</span>
          </Link>
        ))}
      </nav>

      {(matchInvites ?? []).length + (teamInvites ?? []).length > 0 || pendingBookings > 0 ? (
        <Section title={t("needsAttention")} id="attention">
          <div className="grid gap-3 md:grid-cols-2">
            {(matchInvites ?? []).map((i) =>
              i.match ? (
                <Card key={i.id}>
                  <CardBody className="flex flex-col gap-3">
                    <p className="text-sm">
                      {t("matchInvite")} <Link href={`/matches/${i.match.id}`} className="font-semibold hover:underline">{i.match.title}</Link>
                    </p>
                    <div className="flex gap-2">
                      <ActionForm action={respondMatchInvitationAction} className="gap-1">
                        <Hidden values={{ invitation_id: i.id, match_id: i.match.id, accept: "1" }} />
                        <SubmitButton size="sm">{t("accept")}</SubmitButton>
                      </ActionForm>
                      <ActionForm action={respondMatchInvitationAction} className="gap-1">
                        <Hidden values={{ invitation_id: i.id, match_id: i.match.id }} />
                        <SubmitButton size="sm" variant="ghost">{t("decline")}</SubmitButton>
                      </ActionForm>
                    </div>
                  </CardBody>
                </Card>
              ) : null,
            )}
            {(teamInvites ?? []).map((i) =>
              i.team ? (
                <Card key={i.id}>
                  <CardBody className="flex flex-col gap-3">
                    <p className="text-sm">
                      {t("teamInvite")} <Link href={`/teams/${i.team.id}`} className="font-semibold hover:underline">{i.team.name}</Link>
                    </p>
                    <div className="flex gap-2">
                      <ActionForm action={respondTeamInvitationAction} className="gap-1">
                        <Hidden values={{ invitation_id: i.id, team_id: i.team.id, accept: "1" }} />
                        <SubmitButton size="sm">{t("accept")}</SubmitButton>
                      </ActionForm>
                      <ActionForm action={respondTeamInvitationAction} className="gap-1">
                        <Hidden values={{ invitation_id: i.id, team_id: i.team.id }} />
                        <SubmitButton size="sm" variant="ghost">{t("decline")}</SubmitButton>
                      </ActionForm>
                    </div>
                  </CardBody>
                </Card>
              ) : null,
            )}
            {pendingBookings > 0 ? (
              <Card>
                <CardBody className="flex items-center justify-between gap-3">
                  <p className="text-sm">{t("pendingBookings", { count: pendingBookings })}</p>
                  <Link href="/manage/venues" className={buttonClass("primary", "sm")}>{t("review")}</Link>
                </CardBody>
              </Card>
            ) : null}
          </div>
        </Section>
      ) : null}

      <Section title={t("upcoming")} id="upcoming" actions={<Link href="/my/matches" className={buttonClass("ghost", "sm")}>{t("allMine")}</Link>}>
        {upcoming.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {upcoming.slice(0, 6).map((m) => (
              <MatchCard key={m.id} match={m} role={m.role} />
            ))}
          </div>
        ) : (
          <EmptyState title={t("noUpcoming")} action={<Link href="/matches" className={buttonClass("primary", "md")}>{t("quick.find")}</Link>}>
            {t("noUpcomingBody")}
          </EmptyState>
        )}
      </Section>

      <Section title={t("suggested")} id="suggested">
        {suggestions.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {suggestions.map((m) => (
              <MatchCard key={m.id} match={m} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted">{t("noSuggestions")}</p>
        )}
      </Section>
    </Container>
  );
}
