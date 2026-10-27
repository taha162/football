import type { Metadata } from "next";
import { getNow } from "@/lib/now";
import { MessageCircle, Swords } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { Link } from "@/i18n/navigation";
import { requireOnboardedUser } from "@/lib/auth";
import { MATCH_FORMATS, SKILL_LEVELS } from "@/lib/domain/match";
import { formatMoney } from "@/lib/domain/money";
import { formatDateTime, toLocalInputValue } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { getAreas, localizedName } from "@/server/reference";
import { managedTeams, venueOptions } from "@/server/options";
import {
  closeOpponentRequestAction,
  createOpponentRequestAction,
  respondChallengeAction,
  sendChallengeAction,
  withdrawChallengeAction,
} from "@/server/teams/actions";
import { ActionForm, FormField, Hidden, InlineAction, SubmitButton } from "@/components/ui/action-form";
import { buttonClass } from "@/components/ui/button";
import { ChoiceChips, Input, Select, Textarea } from "@/components/ui/field";
import { Alert, Badge, Card, CardBody, Container, EmptyState, PageHeader, Section } from "@/components/ui/primitives";

export async function generateMetadata({ params }: PageProps<"/[locale]/opponents">): Promise<Metadata> {
  const t = await getTranslations({ locale: (await params).locale, namespace: "opponents" });
  return { title: t("title") };
}

const TZ = "Asia/Baghdad";

export default async function OpponentsPage({ params, searchParams }: PageProps<"/[locale]/opponents">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireOnboardedUser(locale as Locale, "/opponents");
  const sp = await searchParams;
  const t = await getTranslations("opponents");
  const e = await getTranslations("enums");
  const supabase = await createClient();
  const [teams, areas, venues] = await Promise.all([managedTeams(user.id), getAreas(), venueOptions()]);
  const teamIds = teams.map((tm) => tm.id);
  const preferredTeam = typeof sp.team === "string" && teamIds.includes(sp.team) ? sp.team : teamIds[0];
  const target = typeof sp.target === "string" && /^[0-9a-f-]{36}$/.test(sp.target) ? sp.target : null;

  const [{ data: openRequests }, { data: myRequests }, { data: incoming }, { data: outgoing }, targetTeam] = await Promise.all([
    supabase
      .from("opponent_requests")
      .select("*, team:teams(id, name, skill_level), venue:venues(id, name)")
      .eq("status", "open")
      .gt("latest_start", new Date().toISOString())
      .order("earliest_start")
      .limit(40),
    teamIds.length
      ? supabase.from("opponent_requests").select("*, team:teams(id, name)").in("team_id", teamIds).order("created_at", { ascending: false }).limit(20)
      : Promise.resolve({ data: [] }),
    teamIds.length
      ? supabase
          .from("opponent_challenges")
          .select("*, challenger:teams!opponent_challenges_challenger_team_id_fkey(id, name), target:teams!opponent_challenges_target_team_id_fkey(id, name)")
          .in("target_team_id", teamIds)
          .order("created_at", { ascending: false })
          .limit(30)
      : Promise.resolve({ data: [] }),
    teamIds.length
      ? supabase
          .from("opponent_challenges")
          .select("*, challenger:teams!opponent_challenges_challenger_team_id_fkey(id, name), target:teams!opponent_challenges_target_team_id_fkey(id, name)")
          .in("challenger_team_id", teamIds)
          .order("created_at", { ascending: false })
          .limit(30)
      : Promise.resolve({ data: [] }),
    target ? supabase.from("teams").select("id, name, city_id").eq("id", target).maybeSingle().then((r) => r.data) : Promise.resolve(null),
  ]);
  const others = (openRequests ?? []).filter((r) => !teamIds.includes(r.team_id));
  const challengeConvs = new Map<string, string>();
  const allChallengeIds = [...(incoming ?? []), ...(outgoing ?? [])].map((c) => c.id);
  if (allChallengeIds.length) {
    const { data: convs } = await supabase.from("conversations").select("id, challenge_id").in("challenge_id", allChallengeIds);
    for (const c of convs ?? []) if (c.challenge_id) challengeConvs.set(c.challenge_id, c.id);
  }
  const minStart = toLocalInputValue(new Date(getNow() + 3_600_000), TZ);
  const defaultStart = toLocalInputValue(new Date(getNow() + 2 * 86_400_000), TZ).slice(0, 10) + "T20:00";
  const statusTone = { pending: "warning", accepted: "success", declined: "danger", withdrawn: "neutral", expired: "neutral" } as const;

  const teamSelect = (
    <FormField name="challenger_team_id" label={t("yourTeam")} required>
      <Select defaultValue={preferredTeam} required>
        {teams.map((tm) => <option key={tm.id} value={tm.id}>{tm.name}</option>)}
      </Select>
    </FormField>
  );

  return (
    <Container className="flex flex-col gap-10 py-10">
      <PageHeader title={t("title")} description={t("description")} />
      {teams.length === 0 ? (
        <Alert tone="info" title={t("needTeamTitle")}>
          {t("needTeamBody")}{" "}
          <Link href="/teams/new" className="text-accent underline">{t("createTeam")}</Link>
        </Alert>
      ) : null}

      {targetTeam && teams.length > 0 ? (
        <Section title={t("directChallenge", { name: targetTeam.name })} id="direct">
          <Card>
            <CardBody>
              <ActionForm action={sendChallengeAction}>
                <Hidden values={{ target_team_id: targetTeam.id }} />
                <div className="grid gap-4 sm:grid-cols-2">
                  {teamSelect}
                  <FormField name="format" label={t("format")}>
                    <Select defaultValue="5v5">
                      {MATCH_FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}
                    </Select>
                  </FormField>
                </div>
                <ChallengeFields t={t} minStart={minStart} defaultStart={defaultStart} venues={venues} />
                <SubmitButton className="self-start">{t("sendChallenge")}</SubmitButton>
              </ActionForm>
            </CardBody>
          </Card>
        </Section>
      ) : null}

      <Section title={t("openRequests")} id="open">
        {others.length === 0 ? (
          <EmptyState icon={<Swords className="size-10" />} title={t("noOpenRequests")}>{t("noOpenRequestsBody")}</EmptyState>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {others.map((r) => (
              <Card key={r.id}>
                <CardBody className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/teams/${r.team_id}`} className="font-display text-lg font-semibold hover:underline">{r.team?.name}</Link>
                    <Badge>{r.format}</Badge>
                    {r.skill_level ? <Badge tone="info">{e(`skill.${r.skill_level}`)}</Badge> : null}
                  </div>
                  <p className="text-sm text-muted">
                    {t("window", { from: formatDateTime(r.earliest_start, locale, TZ), to: formatDateTime(r.latest_start, locale, TZ) })}
                  </p>
                  {r.area_ids.length > 0 ? (
                    <p className="text-sm text-muted">
                      {t("areas")}: {r.area_ids.map((id) => localizedName(areas.find((a) => a.id === id), locale)).filter(Boolean).join("، ")}
                    </p>
                  ) : null}
                  {r.venue ? <p className="text-sm text-muted">{t("venue")}: {r.venue.name}</p> : r.venue_note ? <p className="text-sm text-muted">{r.venue_note}</p> : null}
                  {r.cost_per_team != null ? <p className="text-sm">{t("costPerTeam", { amount: formatMoney(r.cost_per_team, r.currency, locale) })}</p> : null}
                  {r.rules ? <p className="text-sm text-muted">{r.rules}</p> : null}
                  {r.notes ? <p className="text-sm text-muted">{r.notes}</p> : null}
                  {teams.length > 0 ? (
                    <details className="rounded-xl border border-line p-3">
                      <summary className="cursor-pointer text-sm font-semibold text-accent">{t("challenge")}</summary>
                      <ActionForm action={sendChallengeAction} className="mt-3">
                        <Hidden values={{ request_id: r.id }} />
                        {teamSelect}
                        <ChallengeFields
                          t={t}
                          minStart={toLocalInputValue(r.earliest_start, TZ) > minStart ? toLocalInputValue(r.earliest_start, TZ) : minStart}
                          maxStart={toLocalInputValue(r.latest_start, TZ)}
                          defaultStart={toLocalInputValue(r.earliest_start, TZ) > minStart ? toLocalInputValue(r.earliest_start, TZ) : minStart}
                          venues={venues}
                        />
                        <SubmitButton size="sm" className="self-start">{t("sendChallenge")}</SubmitButton>
                      </ActionForm>
                    </details>
                  ) : null}
                </CardBody>
              </Card>
            ))}
          </div>
        )}
      </Section>

      {teams.length > 0 ? (
        <>
          <Section title={t("incoming")} id="incoming">
            {(incoming ?? []).length === 0 ? <p className="text-sm text-muted">{t("noIncoming")}</p> : null}
            <ul className="flex flex-col gap-3">
              {(incoming ?? []).map((c) => (
                <li key={c.id} className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{t("challengeFrom", { from: c.challenger?.name ?? "", to: c.target?.name ?? "" })}</span>
                    <Badge tone={statusTone[c.status]}>{t(`status.${c.status}`)}</Badge>
                  </div>
                  <p className="text-sm text-muted">{formatDateTime(c.proposed_starts_at, locale, TZ)} · {t("minutes", { count: c.duration_minutes })} · {c.format}</p>
                  {c.message ? <p className="text-sm">{c.message}</p> : null}
                  <div className="flex flex-wrap gap-2">
                    {c.status === "pending" ? (
                      <>
                        <InlineAction action={respondChallengeAction} values={{ challenge_id: c.id, accept: "1" }} label={t("accept")} variant="primary" />
                        <InlineAction action={respondChallengeAction} values={{ challenge_id: c.id }} label={t("decline")} variant="ghost" />
                      </>
                    ) : null}
                    {c.match_id ? <Link href={`/matches/${c.match_id}`} className={buttonClass("secondary", "sm")}>{t("viewMatch")}</Link> : null}
                    {challengeConvs.get(c.id) ? (
                      <Link href={`/messages/${challengeConvs.get(c.id)}`} className={buttonClass("ghost", "sm")}>
                        <MessageCircle aria-hidden="true" className="size-4" />
                        {t("negotiate")}
                      </Link>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </Section>

          <Section title={t("outgoing")} id="outgoing">
            {(outgoing ?? []).length === 0 ? <p className="text-sm text-muted">{t("noOutgoing")}</p> : null}
            <ul className="flex flex-col gap-3">
              {(outgoing ?? []).map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface p-4">
                  <span className="flex-1 text-sm">
                    <span className="font-semibold">{c.challenger?.name}</span> → <span className="font-semibold">{c.target?.name}</span>
                    <span className="block text-muted">{formatDateTime(c.proposed_starts_at, locale, TZ)}</span>
                  </span>
                  <Badge tone={statusTone[c.status]}>{t(`status.${c.status}`)}</Badge>
                  {c.status === "pending" ? <InlineAction action={withdrawChallengeAction} values={{ challenge_id: c.id }} label={t("withdraw")} variant="ghost" /> : null}
                  {c.match_id ? <Link href={`/matches/${c.match_id}`} className={buttonClass("secondary", "sm")}>{t("viewMatch")}</Link> : null}
                  {challengeConvs.get(c.id) ? (
                    <Link href={`/messages/${challengeConvs.get(c.id)}`} className={buttonClass("ghost", "sm")}>{t("negotiate")}</Link>
                  ) : null}
                </li>
              ))}
            </ul>
          </Section>

          <Section title={t("myRequests")} id="mine">
            <Card>
              <CardBody>
                <ActionForm action={createOpponentRequestAction} resetOnSuccess>
                  <h3 className="font-semibold">{t("publishRequest")}</h3>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <FormField name="team_id" label={t("yourTeam")} required>
                      <Select defaultValue={preferredTeam}>
                        {teams.map((tm) => <option key={tm.id} value={tm.id}>{tm.name}</option>)}
                      </Select>
                    </FormField>
                    <FormField name="format" label={t("format")} required>
                      <Select defaultValue="5v5">
                        {MATCH_FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}
                      </Select>
                    </FormField>
                    <FormField name="earliest" label={t("earliest")} required>
                      <Input type="datetime-local" min={minStart} defaultValue={defaultStart} required dir="ltr" />
                    </FormField>
                    <FormField name="latest" label={t("latest")} required>
                      <Input type="datetime-local" min={minStart} defaultValue={defaultStart.slice(0, 11) + "23:00"} required dir="ltr" />
                    </FormField>
                    <FormField name="skill_level" label={t("skill")}>
                      <Select defaultValue="">
                        <option value="">{t("anyLevel")}</option>
                        {SKILL_LEVELS.map((s) => <option key={s} value={s}>{e(`skill.${s}`)}</option>)}
                      </Select>
                    </FormField>
                    <FormField name="cost" label={t("costPerTeamLabel")} hint={t("currencyHint")}>
                      <Input inputMode="numeric" dir="ltr" />
                    </FormField>
                    <FormField name="venue_id" label={t("venue")}>
                      <Select defaultValue="">
                        <option value="">{t("noVenue")}</option>
                        {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                      </Select>
                    </FormField>
                    <FormField name="venue_note" label={t("venueNote")}>
                      <Input maxLength={300} />
                    </FormField>
                  </div>
                  <ChoiceChips
                    name="area_ids"
                    legend={t("acceptableAreas")}
                    options={areas.filter((a) => a.city_id === teams[0]?.city_id).map((a) => ({ value: a.id, label: localizedName(a, locale) }))}
                  />
                  <FormField name="rules" label={t("rules")}>
                    <Textarea maxLength={1000} />
                  </FormField>
                  <SubmitButton className="self-start">{t("publish")}</SubmitButton>
                </ActionForm>
              </CardBody>
            </Card>
            <ul className="flex flex-col gap-2">
              {(myRequests ?? []).map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-line p-3 text-sm">
                  <span className="flex-1">
                    <span className="font-semibold">{r.team?.name}</span> · {r.format} · {formatDateTime(r.earliest_start, locale, TZ)}
                  </span>
                  <Badge tone={r.status === "open" ? "success" : "neutral"}>{t(`requestStatus.${r.status}`)}</Badge>
                  {r.status === "open" ? <InlineAction action={closeOpponentRequestAction} values={{ request_id: r.id }} label={t("close")} variant="ghost" /> : null}
                  {r.match_id ? <Link href={`/matches/${r.match_id}`} className={buttonClass("secondary", "sm")}>{t("viewMatch")}</Link> : null}
                </li>
              ))}
            </ul>
          </Section>
        </>
      ) : null}
    </Container>
  );
}

function ChallengeFields({
  t,
  minStart,
  maxStart,
  defaultStart,
  venues,
}: {
  t: Awaited<ReturnType<typeof getTranslations<"opponents">>>;
  minStart: string;
  maxStart?: string;
  defaultStart: string;
  venues: { id: string; name: string }[];
}) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField name="start" label={t("proposedStart")} required>
          <Input type="datetime-local" min={minStart} max={maxStart} defaultValue={defaultStart} required dir="ltr" />
        </FormField>
        <FormField name="duration" label={t("duration")}>
          <Select defaultValue="60">
            {[60, 90, 120].map((d) => <option key={d} value={d}>{t("minutes", { count: d })}</option>)}
          </Select>
        </FormField>
        <FormField name="venue_id" label={t("venue")}>
          <Select defaultValue="">
            <option value="">{t("noVenue")}</option>
            {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </Select>
        </FormField>
        <FormField name="cost" label={t("costPerTeamLabel")} hint={t("currencyHint")}>
          <Input inputMode="numeric" dir="ltr" />
        </FormField>
      </div>
      <FormField name="message" label={t("message")}>
        <Textarea maxLength={1000} />
      </FormField>
    </>
  );
}
