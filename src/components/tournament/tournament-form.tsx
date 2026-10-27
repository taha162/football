"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ActionForm, FormField, Hidden, SubmitButton } from "@/components/ui/action-form";
import { Input, Select, Textarea } from "@/components/ui/field";
import { MATCH_FORMATS } from "@/lib/domain/match";
import { upsertTournamentAction } from "@/server/tournaments/actions";

export interface TournamentDefaults {
  id?: string;
  name?: string;
  description?: string | null;
  city_id?: string;
  venue_id?: string | null;
  format?: string;
  tournament_format?: string;
  team_capacity?: number;
  group_count?: number;
  advance_per_group?: number;
  min_team_size?: number;
  deadline?: string;
  starts_on?: string;
  ends_on?: string;
  entry_fee?: number | null;
  eligibility?: string | null;
  rules?: string | null;
  prizes?: string | null;
  points_win?: number;
  points_draw?: number;
  points_loss?: number;
  locked?: boolean;
}

export function TournamentForm({ defaults, cities, venues }: { defaults: TournamentDefaults; cities: { id: string; name_en: string; name_ar: string }[]; venues: { id: string; name: string; city_id: string }[] }) {
  const t = useTranslations("tournamentForm");
  const locale = useLocale();
  const [format, setFormat] = useState(defaults.tournament_format ?? "round_robin");
  const [city, setCity] = useState(defaults.city_id ?? cities[0]?.id);
  return (
    <ActionForm action={upsertTournamentAction} successMessage={t("saved")} className="gap-6">
      <Hidden values={{ tournament_id: defaults.id }} />
      <FormField name="name" label={t("name")} required>
        {(a) => <Input {...a} defaultValue={defaults.name} required minLength={3} maxLength={100} />}
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField name="city_id" label={t("city")} required>
          {(a) => (
            <Select {...a} value={city} onChange={(e) => setCity(e.target.value)}>
              {cities.map((c) => <option key={c.id} value={c.id}>{locale === "ar" ? c.name_ar : c.name_en}</option>)}
            </Select>
          )}
        </FormField>
        <FormField name="venue_id" label={t("venue")}>
          {(a) => (
            <Select {...a} defaultValue={defaults.venue_id ?? ""}>
              <option value="">{t("noVenue")}</option>
              {venues.filter((v) => v.city_id === city).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </Select>
          )}
        </FormField>
        <FormField name="format" label={t("matchFormat")} required>
          {(a) => (
            <Select {...a} defaultValue={defaults.format ?? "5v5"}>
              {MATCH_FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}
            </Select>
          )}
        </FormField>
        <FormField name="tournament_format" label={t("structure")} required>
          {(a) => (
            <Select {...a} value={format} onChange={(e) => setFormat(e.target.value)} disabled={defaults.locked}>
              <option value="round_robin">{t("roundRobin")}</option>
              <option value="single_elimination">{t("knockout")}</option>
              <option value="groups_knockout">{t("groupsKnockout")}</option>
            </Select>
          )}
        </FormField>
        {defaults.locked ? <input type="hidden" name="tournament_format" value={format} /> : null}
        <FormField name="team_capacity" label={t("capacity")} required>
          {(a) => <Input {...a} type="number" min={2} max={64} defaultValue={defaults.team_capacity ?? 8} required />}
        </FormField>
        <FormField name="min_team_size" label={t("minTeamSize")} hint={t("minTeamSizeHint")}>
          {(a) => <Input {...a} type="number" min={1} max={30} defaultValue={defaults.min_team_size ?? 5} />}
        </FormField>
        {format === "groups_knockout" ? (
          <>
            <FormField name="group_count" label={t("groups")}>
              {(a) => <Input {...a} type="number" min={2} max={16} defaultValue={defaults.group_count ?? 2} />}
            </FormField>
            <FormField name="advance_per_group" label={t("advance")}>
              {(a) => <Input {...a} type="number" min={1} max={8} defaultValue={defaults.advance_per_group ?? 2} />}
            </FormField>
          </>
        ) : null}
        <FormField name="deadline" label={t("deadline")} required>
          {(a) => <Input {...a} type="datetime-local" defaultValue={defaults.deadline} required dir="ltr" />}
        </FormField>
        <FormField name="entry_fee" label={t("entryFee")} hint={t("entryFeeHint")}>
          {(a) => <Input {...a} inputMode="numeric" defaultValue={defaults.entry_fee ?? ""} dir="ltr" />}
        </FormField>
        <FormField name="starts_on" label={t("startsOn")} required>
          {(a) => <Input {...a} type="date" defaultValue={defaults.starts_on} required dir="ltr" />}
        </FormField>
        <FormField name="ends_on" label={t("endsOn")} required>
          {(a) => <Input {...a} type="date" defaultValue={defaults.ends_on} required dir="ltr" />}
        </FormField>
      </div>
      <fieldset className="grid grid-cols-3 gap-4" disabled={defaults.locked}>
        <legend className="col-span-3 mb-1 text-sm font-medium">{t("points")}</legend>
        <FormField name="points_win" label={t("win")}>{(a) => <Input {...a} type="number" min={0} max={10} defaultValue={defaults.points_win ?? 3} />}</FormField>
        <FormField name="points_draw" label={t("draw")}>{(a) => <Input {...a} type="number" min={0} max={10} defaultValue={defaults.points_draw ?? 1} />}</FormField>
        <FormField name="points_loss" label={t("loss")}>{(a) => <Input {...a} type="number" min={0} max={10} defaultValue={defaults.points_loss ?? 0} />}</FormField>
      </fieldset>
      {defaults.locked ? (
        <>
          <input type="hidden" name="points_win" value={defaults.points_win} />
          <input type="hidden" name="points_draw" value={defaults.points_draw} />
          <input type="hidden" name="points_loss" value={defaults.points_loss} />
        </>
      ) : null}
      <p className="-mt-3 text-xs text-muted">{t("tiebreakers")}</p>
      <FormField name="description" label={t("description")}>{(a) => <Textarea {...a} defaultValue={defaults.description ?? ""} maxLength={3000} />}</FormField>
      <FormField name="eligibility" label={t("eligibility")}>{(a) => <Textarea {...a} defaultValue={defaults.eligibility ?? ""} maxLength={1000} />}</FormField>
      <FormField name="rules" label={t("rules")}>{(a) => <Textarea {...a} defaultValue={defaults.rules ?? ""} maxLength={3000} />}</FormField>
      <FormField name="prizes" label={t("prizes")}>{(a) => <Textarea {...a} defaultValue={defaults.prizes ?? ""} maxLength={1000} />}</FormField>
      <SubmitButton size="lg" className="self-start">{defaults.id ? t("save") : t("create")}</SubmitButton>
    </ActionForm>
  );
}
