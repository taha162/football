"use client";

import { useTranslations } from "next-intl";
import { ActionForm, FormField, Hidden, SubmitButton } from "@/components/ui/action-form";
import { Input, Select, Textarea } from "@/components/ui/field";
import { LocationFields, type AreaOption, type CityOption } from "@/components/forms/location-fields";
import { MATCH_FORMATS, SKILL_LEVELS } from "@/lib/domain/match";
import { createTeamAction, updateTeamAction } from "@/server/teams/actions";

export interface TeamDefaults {
  id?: string;
  name?: string;
  description?: string | null;
  city_id?: string | null;
  area_id?: string | null;
  visibility?: string;
  join_policy?: string;
  skill_level?: string | null;
  preferred_format?: string | null;
  preferred_formation?: string | null;
  home_venue_id?: string | null;
}

export function TeamForm({ defaults, cities, areas, venues }: { defaults: TeamDefaults; cities: CityOption[]; areas: AreaOption[]; venues: { id: string; name: string }[] }) {
  const t = useTranslations("teamForm");
  const e = useTranslations("enums");
  return (
    <ActionForm action={defaults.id ? updateTeamAction : createTeamAction} successMessage={t("saved")}>
      <Hidden values={{ team_id: defaults.id }} />
      <FormField name="name" label={t("name")} required>
        {(a) => <Input {...a} defaultValue={defaults.name} required minLength={2} maxLength={60} />}
      </FormField>
      <LocationFields cities={cities} areas={areas} defaultCity={defaults.city_id} defaultArea={defaults.area_id} />
      <FormField name="description" label={t("description")}>
        {(a) => <Textarea {...a} defaultValue={defaults.description ?? ""} maxLength={1000} />}
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField name="visibility" label={t("visibility")} hint={t("visibilityHint")}>
          {(a) => (
            <Select {...a} defaultValue={defaults.visibility ?? "public"}>
              <option value="public">{t("public")}</option>
              <option value="private">{t("private")}</option>
            </Select>
          )}
        </FormField>
        <FormField name="join_policy" label={t("joinPolicy")}>
          {(a) => (
            <Select {...a} defaultValue={defaults.join_policy ?? "request"}>
              <option value="request">{t("policyRequest")}</option>
              <option value="invite_only">{t("policyInvite")}</option>
            </Select>
          )}
        </FormField>
        <FormField name="skill_level" label={t("skill")}>
          {(a) => (
            <Select {...a} defaultValue={defaults.skill_level ?? ""}>
              <option value="">{t("anyLevel")}</option>
              {SKILL_LEVELS.map((s) => (
                <option key={s} value={s}>{e(`skill.${s}`)}</option>
              ))}
            </Select>
          )}
        </FormField>
        <FormField name="preferred_format" label={t("format")}>
          {(a) => (
            <Select {...a} defaultValue={defaults.preferred_format ?? ""}>
              <option value="">—</option>
              {MATCH_FORMATS.map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </Select>
          )}
        </FormField>
        <FormField name="preferred_formation" label={t("formation")} hint={t("formationHint")}>
          {(a) => <Input {...a} defaultValue={defaults.preferred_formation ?? ""} placeholder="2-2-1" dir="ltr" pattern="[0-9]{1,2}(-[0-9]{1,2}){1,4}" />}
        </FormField>
        {defaults.id ? (
          <FormField name="home_venue_id" label={t("homeVenue")}>
            {(a) => (
              <Select {...a} defaultValue={defaults.home_venue_id ?? ""}>
                <option value="">—</option>
                {venues.map((v) => (
                  <option key={v.id} value={v.id}>{v.name}</option>
                ))}
              </Select>
            )}
          </FormField>
        ) : null}
      </div>
      <SubmitButton size="lg" className="self-start">{defaults.id ? t("save") : t("create")}</SubmitButton>
    </ActionForm>
  );
}
