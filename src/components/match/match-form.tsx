"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ActionForm, FormField, Hidden, SubmitButton } from "@/components/ui/action-form";
import { Checkbox, ChoiceChips, Input, Select, Textarea } from "@/components/ui/field";
import { Alert } from "@/components/ui/primitives";
import { LocationFields, type AreaOption, type CityOption } from "@/components/forms/location-fields";
import { defaultRosterSize, MATCH_FORMATS, POSITIONS, SKILL_LEVELS, type MatchFormat } from "@/lib/domain/match";
import { formatMoney, parseMoneyInput, splitCost } from "@/lib/domain/money";
import { createMatchAction, updateMatchAction } from "@/server/matches/actions";

export interface VenueOption {
  id: string;
  name: string;
  city_id: string;
  fields: { id: string; name: string }[];
}

export interface MatchFormDefaults {
  id?: string;
  title?: string;
  description?: string | null;
  city_id?: string;
  area_id?: string | null;
  venue_id?: string | null;
  field_id?: string | null;
  location_note?: string | null;
  start?: string;
  duration?: number;
  format?: MatchFormat;
  match_type?: string;
  team_id?: string | null;
  total_players?: number;
  reserved_spots?: number;
  positions_needed?: Record<string, number>;
  skill_level?: string | null;
  total_cost?: number | null;
  paying_players?: number | null;
  price_per_player?: number | null;
  cost_is_estimate?: boolean;
  payment_collector?: string;
  payment_notes?: string | null;
  rules?: string | null;
  visibility?: string;
  join_policy?: string;
  leave_deadline_hours?: number;
  external_booking?: boolean;
}

export function MatchForm({
  mode,
  defaults,
  cities,
  areas,
  venues,
  teams,
  minStart,
}: {
  mode: "create" | "edit";
  defaults: MatchFormDefaults;
  cities: CityOption[];
  areas: AreaOption[];
  venues: VenueOption[];
  teams: { id: string; name: string }[];
  minStart: string;
}) {
  const t = useTranslations("matchForm");
  const e = useTranslations("enums");
  const m = useTranslations("match");
  const locale = useLocale();
  const [format, setFormat] = useState<MatchFormat>(defaults.format ?? "5v5");
  const [total, setTotal] = useState<number>(defaults.total_players ?? defaultRosterSize(defaults.format ?? "5v5"));
  const [matchType, setMatchType] = useState(defaults.match_type ?? "open");
  const [venueId, setVenueId] = useState(defaults.venue_id ?? "");
  const [cost, setCost] = useState(defaults.total_cost != null ? String(defaults.total_cost) : "");
  const [paying, setPaying] = useState(defaults.paying_players != null ? String(defaults.paying_players) : "");
  const [override, setOverride] = useState(defaults.price_per_player != null && defaults.total_cost == null ? String(defaults.price_per_player) : "");
  const currency = "IQD";

  const share = useMemo(() => {
    const c = parseMoneyInput(cost, currency);
    const p = paying ? Number(paying) : total;
    return c == null ? null : splitCost(c, p > 0 ? p : total);
  }, [cost, paying, total]);
  const venue = venues.find((v) => v.id === venueId);

  return (
    <ActionForm action={mode === "create" ? createMatchAction : updateMatchAction} className="gap-8">
      <Hidden values={{ match_id: defaults.id }} />

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-3 font-display text-xl font-semibold">{t("basics")}</legend>
        <FormField name="title" label={t("title")} hint={t("titleHint")} required>
          {(a) => <Input {...a} defaultValue={defaults.title} required minLength={3} maxLength={100} />}
        </FormField>
        {mode === "create" ? (
          <>
            <ChoiceChips
              name="match_type"
              type="radio"
              legend={t("matchType")}
              defaultValue={matchType}
              options={(["open", "team_needs_players", "private"] as const).map((x) => ({ value: x, label: m(`type.${x}`) }))}
            />
            <MatchTypeWatcher onChange={setMatchType} />
            {matchType === "team_needs_players" ? (
              teams.length > 0 ? (
                <FormField name="team_id" label={t("team")} required>
                  {(a) => (
                    <Select {...a} defaultValue={defaults.team_id ?? teams[0].id} required>
                      {teams.map((tm) => (
                        <option key={tm.id} value={tm.id}>{tm.name}</option>
                      ))}
                    </Select>
                  )}
                </FormField>
              ) : (
                <Alert tone="warning">{t("noManagedTeams")}</Alert>
              )
            ) : null}
            {matchType === "private" ? <Alert tone="info">{t("privateHint")}</Alert> : null}
          </>
        ) : null}
        <FormField name="description" label={t("description")}>
          {(a) => <Textarea {...a} defaultValue={defaults.description ?? ""} maxLength={2000} />}
        </FormField>
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-3 font-display text-xl font-semibold">{t("whenWhere")}</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField name="start" label={t("start")} hint={t("startHint")} required>
            {(a) => <Input {...a} type="datetime-local" defaultValue={defaults.start} min={minStart} required dir="ltr" />}
          </FormField>
          <FormField name="duration" label={t("duration")} required>
            {(a) => (
              <Select {...a} defaultValue={String(defaults.duration ?? 90)}>
                {[60, 90, 120, 150, 180].map((d) => (
                  <option key={d} value={d}>{t("minutes", { count: d })}</option>
                ))}
              </Select>
            )}
          </FormField>
        </div>
        {mode === "create" ? (
          <LocationFields cities={cities} areas={areas} defaultCity={defaults.city_id} defaultArea={defaults.area_id} />
        ) : (
          <FormField name="area_id" label={t("area")}>
            {(a) => (
              <Select {...a} defaultValue={defaults.area_id ?? ""}>
                <option value="">{t("noArea")}</option>
                {areas
                  .filter((ar) => ar.city_id === defaults.city_id)
                  .map((ar) => (
                    <option key={ar.id} value={ar.id}>{locale === "ar" ? ar.name_ar : ar.name_en}</option>
                  ))}
              </Select>
            )}
          </FormField>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField name="venue_id" label={t("venue")} hint={t("venueHint")}>
            {(a) => (
              <Select {...a} value={venueId} onChange={(ev) => setVenueId(ev.target.value)}>
                <option value="">{t("noVenue")}</option>
                {venues.map((v) => (
                  <option key={v.id} value={v.id}>{v.name}</option>
                ))}
              </Select>
            )}
          </FormField>
          {venue && venue.fields.length > 0 ? (
            <FormField name="field_id" label={t("field")}>
              {(a) => (
                <Select {...a} defaultValue={defaults.field_id ?? ""} key={venue.id}>
                  <option value="">{t("anyField")}</option>
                  {venue.fields.map((f) => (
                    <option key={f.id} value={f.id}>{f.name}</option>
                  ))}
                </Select>
              )}
            </FormField>
          ) : null}
        </div>
        <FormField name="location_note" label={t("locationNote")} hint={t("locationNoteHint")}>
          {(a) => <Input {...a} defaultValue={defaults.location_note ?? ""} maxLength={300} />}
        </FormField>
        <Checkbox name="external_booking" defaultChecked={defaults.external_booking} label={t("externalBooking")} />
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-3 font-display text-xl font-semibold">{t("players")}</legend>
        <div className="grid gap-4 sm:grid-cols-3">
          {mode === "create" ? (
            <FormField name="format" label={t("format")} required>
              {(a) => (
                <Select
                  {...a}
                  value={format}
                  onChange={(ev) => {
                    const f = ev.target.value as MatchFormat;
                    setFormat(f);
                    setTotal(defaultRosterSize(f));
                  }}
                >
                  {MATCH_FORMATS.map((f) => (
                    <option key={f} value={f}>{f}</option>
                  ))}
                </Select>
              )}
            </FormField>
          ) : null}
          <FormField name="total_players" label={t("totalPlayers")} hint={t("totalPlayersHint")} required>
            {(a) => <Input {...a} type="number" min={2} max={30} value={total} onChange={(ev) => setTotal(Number(ev.target.value))} required />}
          </FormField>
          <FormField name="reserved_spots" label={t("reservedSpots")} hint={t("reservedSpotsHint")}>
            {(a) => <Input {...a} type="number" min={0} max={29} defaultValue={defaults.reserved_spots ?? 0} />}
          </FormField>
        </div>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">{t("positionsNeeded")}</legend>
          <p className="text-xs text-muted">{t("positionsNeededHint")}</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {POSITIONS.map((p) => (
              <label key={p} className="flex flex-col gap-1 text-xs text-muted">
                {e(`position.${p}`)}
                <Input type="number" name={`need_${p}`} min={0} max={30} defaultValue={defaults.positions_needed?.[p] ?? 0} />
              </label>
            ))}
          </div>
        </fieldset>
        <ChoiceChips
          name="skill_level"
          type="radio"
          legend={t("skillLevel")}
          defaultValue={defaults.skill_level ?? ""}
          options={[{ value: "", label: t("allLevels") }, ...SKILL_LEVELS.map((s) => ({ value: s, label: e(`skill.${s}`) }))]}
        />
        {mode === "create" ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Checkbox name="organizer_plays" defaultChecked label={t("organizerPlays")} />
            <FormField name="organizer_position" label={t("myPosition")}>
              {(a) => (
                <Select {...a} defaultValue="">
                  <option value="">{t("anyPosition")}</option>
                  {POSITIONS.map((p) => (
                    <option key={p} value={p}>{e(`position.${p}`)}</option>
                  ))}
                </Select>
              )}
            </FormField>
          </div>
        ) : null}
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-3 font-display text-xl font-semibold">{t("cost")}</legend>
        <p className="text-sm text-muted">{t("costIntro")}</p>
        <div className="grid gap-4 sm:grid-cols-3">
          <FormField name="total_cost" label={t("totalCost")} hint={t("currencyHint")}>
            {(a) => <Input {...a} inputMode="numeric" value={cost} onChange={(ev) => setCost(ev.target.value)} dir="ltr" placeholder="50000" />}
          </FormField>
          <FormField name="paying_players" label={t("payingPlayers")} hint={t("payingPlayersHint")}>
            {(a) => <Input {...a} type="number" min={1} max={60} value={paying} onChange={(ev) => setPaying(ev.target.value)} placeholder={String(total)} />}
          </FormField>
          <FormField name="price_per_player" label={t("pricePerPlayer")} hint={t("pricePerPlayerHint")}>
            {(a) => <Input {...a} inputMode="numeric" value={override} onChange={(ev) => setOverride(ev.target.value)} dir="ltr" />}
          </FormField>
        </div>
        <div aria-live="polite" className="rounded-xl border border-line bg-surface-2 p-3 text-sm">
          {override && parseMoneyInput(override, currency) != null ? (
            t("sharePreviewOverride", { amount: formatMoney(parseMoneyInput(override, currency)!, currency, locale) })
          ) : share != null ? (
            t("sharePreview", { amount: formatMoney(share, currency, locale), players: paying || total })
          ) : (
            t("sharePreviewNone")
          )}
        </div>
        <Checkbox name="cost_is_estimate" defaultChecked={defaults.cost_is_estimate ?? true} label={t("costIsEstimate")} />
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField name="payment_collector" label={t("paymentCollector")}>
            {(a) => (
              <Select {...a} defaultValue={defaults.payment_collector ?? "organizer"}>
                {(["organizer", "venue", "each_player", "none"] as const).map((c) => (
                  <option key={c} value={c}>{t(`collector.${c}`)}</option>
                ))}
              </Select>
            )}
          </FormField>
          <FormField name="payment_notes" label={t("paymentNotes")}>
            {(a) => <Input {...a} defaultValue={defaults.payment_notes ?? ""} maxLength={500} />}
          </FormField>
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-3 font-display text-xl font-semibold">{t("rules")}</legend>
        <div className="grid gap-4 sm:grid-cols-3">
          {matchType !== "private" ? (
            <>
              <FormField name="visibility" label={t("visibility")}>
                {(a) => (
                  <Select {...a} defaultValue={defaults.visibility ?? "public"}>
                    <option value="public">{t("visibilityPublic")}</option>
                    <option value="private">{t("visibilityPrivate")}</option>
                  </Select>
                )}
              </FormField>
              <FormField name="join_policy" label={t("joinPolicy")}>
                {(a) => (
                  <Select {...a} defaultValue={defaults.join_policy ?? "open"}>
                    <option value="open">{t("policy.open")}</option>
                    <option value="approval">{t("policy.approval")}</option>
                    <option value="invite_only">{t("policy.invite_only")}</option>
                  </Select>
                )}
              </FormField>
            </>
          ) : null}
          <FormField name="leave_deadline_hours" label={t("leaveDeadline")} hint={t("leaveDeadlineHint")}>
            {(a) => <Input {...a} type="number" min={0} max={72} defaultValue={defaults.leave_deadline_hours ?? 6} />}
          </FormField>
        </div>
        <FormField name="rules" label={t("rulesText")}>
          {(a) => <Textarea {...a} defaultValue={defaults.rules ?? ""} maxLength={1000} />}
        </FormField>
        {mode === "create" ? (
          <FormField name="repeat_weeks" label={t("repeat")} hint={t("repeatHint")}>
            {(a) => (
              <Select {...a} defaultValue="0">
                {[0, 1, 2, 3, 5, 7, 11].map((n) => (
                  <option key={n} value={n}>{n === 0 ? t("noRepeat") : t("repeatWeeks", { count: n })}</option>
                ))}
              </Select>
            )}
          </FormField>
        ) : null}
      </fieldset>

      <div className="flex flex-wrap gap-3">
        <SubmitButton size="lg" name="intent" value="publish">
          {mode === "create" ? t("publish") : t("saveChanges")}
        </SubmitButton>
        {mode === "create" ? (
          <SubmitButton size="lg" variant="outline" name="intent" value="draft">
            {t("saveDraft")}
          </SubmitButton>
        ) : null}
      </div>
    </ActionForm>
  );
}

/** Keeps the match-type state in sync with the radio chips (which are uncontrolled). */
function MatchTypeWatcher({ onChange }: { onChange: (v: string) => void }) {
  return (
    <span
      hidden
      ref={(el) => {
        const form = el?.closest("form");
        if (!form || form.dataset.watching) return;
        form.dataset.watching = "1";
        form.addEventListener("change", (ev) => {
          const target = ev.target as HTMLInputElement;
          if (target.name === "match_type") onChange(target.value);
        });
      }}
    />
  );
}
