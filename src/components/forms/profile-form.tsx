"use client";

import { useTranslations } from "next-intl";
import { ActionForm, FormField, Hidden, SubmitButton } from "@/components/ui/action-form";
import { Checkbox, ChoiceChips, Input, Textarea } from "@/components/ui/field";
import { MATCH_FORMATS, POSITIONS, SKILL_LEVELS } from "@/lib/domain/match";
import { saveProfileAction } from "@/server/profile";
import { LocationFields, type AreaOption, type CityOption } from "./location-fields";

const TIMES = ["weekday_evening", "weekday_night", "weekday_afternoon", "weekday_morning", "weekend_evening", "weekend_night", "weekend_afternoon", "weekend_morning"];

export interface ProfileDefaults {
  display_name: string;
  city_id: string | null;
  area_id: string | null;
  bio: string | null;
  positions: string[];
  skill_level: string | null;
  preferred_formats: string[];
  preferred_times: string[];
  show_match_history: boolean;
}

export function ProfileForm({
  defaults,
  cities,
  areas,
  onboarding,
  next,
}: {
  defaults: ProfileDefaults;
  cities: CityOption[];
  areas: AreaOption[];
  onboarding?: boolean;
  next?: string;
}) {
  const t = useTranslations("profile");
  const e = useTranslations("enums");
  return (
    <ActionForm action={saveProfileAction} className="gap-6">
      <Hidden values={{ onboarding: onboarding ? "1" : undefined, next }} />
      <FormField name="display_name" label={t("displayName")} hint={t("displayNameHint")} required>
        {(a) => <Input {...a} defaultValue={defaults.display_name} required minLength={2} maxLength={40} autoComplete="nickname" />}
      </FormField>
      <LocationFields
        cities={cities}
        areas={areas}
        defaultCity={defaults.city_id}
        defaultArea={defaults.area_id}
        areaLabel={t("publicArea")}
        areaHint={t("publicAreaHint")}
      />
      <ChoiceChips
        name="positions"
        legend={t("positions")}
        defaultValue={defaults.positions}
        options={POSITIONS.map((p) => ({ value: p, label: e(`position.${p}`) }))}
      />
      <ChoiceChips
        name="skill_level"
        type="radio"
        legend={t("skillLevel")}
        defaultValue={defaults.skill_level}
        options={SKILL_LEVELS.map((s) => ({ value: s, label: e(`skill.${s}`) }))}
      />
      <p className="-mt-4 text-xs text-muted">{t("skillSelfReported")}</p>
      <ChoiceChips
        name="preferred_formats"
        legend={t("formats")}
        defaultValue={defaults.preferred_formats}
        options={MATCH_FORMATS.map((f) => ({ value: f, label: f }))}
      />
      <ChoiceChips
        name="preferred_times"
        legend={t("times")}
        defaultValue={defaults.preferred_times}
        options={TIMES.map((x) => ({ value: x, label: e(`time.${x}`) }))}
      />
      {!onboarding ? (
        <FormField name="bio" label={t("bio")} hint={t("bioHint")}>
          {(a) => <Textarea {...a} defaultValue={defaults.bio ?? ""} maxLength={500} />}
        </FormField>
      ) : null}
      <Checkbox name="show_match_history" defaultChecked={defaults.show_match_history} label={t("showHistory")} />
      <SubmitButton size="lg" className="self-start">
        {onboarding ? t("finishOnboarding") : t("save")}
      </SubmitButton>
    </ActionForm>
  );
}
