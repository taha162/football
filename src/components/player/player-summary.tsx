import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { formatDate } from "@/lib/format";
import { publicStorageUrl } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/auth";
import { localizedName } from "@/server/reference";
import { Avatar } from "@/components/ui/avatar";
import { Badge, Card, CardBody, Section, Stat } from "@/components/ui/primitives";

/** Public view of a player: identity, preferences, teams, statistics, reputation, history. */
export async function PlayerSummary({ profile, viewerId }: { profile: Profile; viewerId: string | null }) {
  const t = await getTranslations("player");
  const e = await getTranslations("enums");
  const locale = await getLocale();
  const supabase = await createClient();
  const [{ data: city }, { data: area }, { data: teams }, { data: stats }, { data: reputation }, history] = await Promise.all([
    profile.city_id ? supabase.from("cities").select("name_en, name_ar, timezone").eq("id", profile.city_id).maybeSingle() : Promise.resolve({ data: null }),
    profile.area_id ? supabase.from("areas").select("name_en, name_ar").eq("id", profile.area_id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from("team_members").select("role, team:teams(id, name, is_archived)").eq("user_id", profile.id),
    supabase.rpc("player_stats", { p_user_id: profile.id }),
    supabase.rpc("player_reputation", { p_user_id: profile.id }),
    viewerId
      ? supabase
          .from("match_participants")
          .select("status, match:matches(id, title, starts_at, status)")
          .eq("user_id", profile.id)
          .eq("status", "confirmed")
          .order("joined_at", { ascending: false })
          .limit(15)
          .then((r) => r.data ?? [])
      : Promise.resolve([]),
  ]);
  const s = stats as null | Record<string, number>;
  const rep = reputation as null | { count: number; visible: boolean; reliability?: number; punctuality?: number; sportsmanship?: number; organization?: number | null };
  const tz = city?.timezone ?? "Asia/Baghdad";
  const visibleTeams = (teams ?? []).filter((x) => x.team && !x.team.is_archived);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <Avatar src={publicStorageUrl("avatars", profile.avatar_path)} name={profile.display_name} size={88} />
        <div className="flex flex-col gap-1.5">
          <h1 className="font-display text-3xl font-bold">{profile.display_name}</h1>
          <p className="text-muted">{[localizedName(area, locale), localizedName(city, locale)].filter(Boolean).join("، ")}</p>
          <div className="flex flex-wrap gap-1.5">
            {profile.positions.map((p) => <Badge key={p} tone="accent">{e(`position.${p}`)}</Badge>)}
            {profile.skill_level ? <Badge tone="info">{t("selfReported", { level: e(`skill.${profile.skill_level}`) })}</Badge> : null}
            {profile.preferred_formats.map((f) => <Badge key={f}>{f}</Badge>)}
            {profile.status === "suspended" ? <Badge tone="danger">{t("suspended")}</Badge> : null}
          </div>
        </div>
      </div>
      {profile.bio ? <p className="max-w-2xl whitespace-pre-line text-muted" dir="auto">{profile.bio}</p> : null}

      <Section title={t("stats")} id="stats">
        {s ? (
          <>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label={t("matchesPlayed")} value={s.matches_played} />
              <Stat label={t("goals")} value={s.goals} />
              <Stat label={t("assists")} value={s.assists} />
              <Stat label={t("cleanSheets")} value={s.clean_sheets} />
            </dl>
            <p className="text-xs text-muted">{t("statsNote", { verified: s.verified_results })}</p>
          </>
        ) : (
          <p className="text-sm text-muted">{t("statsHidden")}</p>
        )}
      </Section>

      <Section title={t("reliability")} id="reliability">
        {rep?.visible ? (
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label={t("rating.reliability")} value={rep.reliability ?? "—"} />
            <Stat label={t("rating.punctuality")} value={rep.punctuality ?? "—"} />
            <Stat label={t("rating.sportsmanship")} value={rep.sportsmanship ?? "—"} />
            {rep.organization != null ? <Stat label={t("rating.organization")} value={rep.organization} /> : null}
          </dl>
        ) : (
          <p className="text-sm text-muted">{t("notEnoughReviews", { count: rep?.count ?? 0 })}</p>
        )}
        {s && s.attendance_marked > 0 ? <p className="text-xs text-muted">{t("attendance", { noShows: s.no_shows, marked: s.attendance_marked, late: s.late_withdrawals })}</p> : null}
        <p className="text-xs text-muted">{t("reliabilityNote")}</p>
      </Section>

      {visibleTeams.length > 0 ? (
        <Section title={t("teams")} id="teams">
          <div className="flex flex-wrap gap-2">
            {visibleTeams.map((x) => (
              <Link key={x.team!.id} href={`/teams/${x.team!.id}`} className="rounded-xl border border-line bg-surface px-3 py-2 text-sm hover:border-accent/50">
                {x.team!.name} {x.role !== "player" ? <span className="text-xs text-accent">· {t(`role.${x.role}`)}</span> : null}
              </Link>
            ))}
          </div>
        </Section>
      ) : null}

      {viewerId ? (
        <Section title={t("history")} id="history">
          {history.length === 0 ? (
            <p className="text-sm text-muted">{t("noHistory")}</p>
          ) : (
            <Card>
              <CardBody className="p-0">
                <ul className="divide-y divide-line">
                  {history.map((h) =>
                    h.match ? (
                      <li key={h.match.id} className="flex items-center justify-between gap-3 p-3 text-sm">
                        <Link href={`/matches/${h.match.id}`} className="hover:underline">{h.match.title}</Link>
                        <span className="text-xs text-muted">{formatDate(h.match.starts_at, locale, tz)}</span>
                      </li>
                    ) : null,
                  )}
                </ul>
              </CardBody>
            </Card>
          )}
        </Section>
      ) : null}
    </div>
  );
}
