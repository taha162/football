"use client";

import { useTranslations } from "next-intl";
import { ActionForm, FormField, Hidden, SubmitButton } from "@/components/ui/action-form";
import { Checkbox, ChoiceChips, Input, Select, Textarea } from "@/components/ui/field";
import { Alert } from "@/components/ui/primitives";
import { LocationFields, type AreaOption, type CityOption } from "@/components/forms/location-fields";
import { FACILITIES } from "@/lib/domain/venue";
import { createVenueAction, updateVenueAction } from "@/server/venues/actions";

export interface VenueDefaults {
  id?: string;
  name?: string;
  description?: string | null;
  city_id?: string | null;
  area_id?: string | null;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  phone?: string | null;
  whatsapp?: string | null;
  facilities?: string[];
  booking_mode?: string;
  auto_confirm_bookings?: boolean;
  buffer_minutes?: number;
  min_notice_minutes?: number;
  max_advance_days?: number;
  cancellation_deadline_hours?: number;
  cancellation_policy?: string | null;
  verification_status?: string;
}

export function VenueForm({ defaults, cities, areas, canEditSettings }: { defaults: VenueDefaults; cities: CityOption[]; areas: AreaOption[]; canEditSettings: boolean }) {
  const t = useTranslations("venueForm");
  const v = useTranslations("venuePage");
  const editing = Boolean(defaults.id);
  return (
    <ActionForm action={editing ? updateVenueAction : createVenueAction} className="gap-6">
      <Hidden values={{ venue_id: defaults.id }} />
      <FormField name="name" label={t("name")} required>
        {(a) => <Input {...a} defaultValue={defaults.name} required minLength={2} maxLength={100} />}
      </FormField>
      <LocationFields cities={cities} areas={areas} defaultCity={defaults.city_id} defaultArea={defaults.area_id} />
      <FormField name="address" label={t("address")}>
        {(a) => <Input {...a} defaultValue={defaults.address ?? ""} maxLength={300} />}
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField name="latitude" label={t("latitude")} hint={t("coordsHint")}>
          {(a) => <Input {...a} inputMode="decimal" defaultValue={defaults.latitude ?? ""} dir="ltr" />}
        </FormField>
        <FormField name="longitude" label={t("longitude")}>
          {(a) => <Input {...a} inputMode="decimal" defaultValue={defaults.longitude ?? ""} dir="ltr" />}
        </FormField>
        <FormField name="phone" label={t("phone")} hint={t("phoneHint")}>
          {(a) => <Input {...a} type="tel" defaultValue={defaults.phone ?? ""} dir="ltr" />}
        </FormField>
        <FormField name="whatsapp" label={t("whatsapp")}>
          {(a) => <Input {...a} type="tel" defaultValue={defaults.whatsapp ?? ""} dir="ltr" />}
        </FormField>
      </div>
      <FormField name="description" label={t("description")}>
        {(a) => <Textarea {...a} defaultValue={defaults.description ?? ""} maxLength={2000} />}
      </FormField>
      <ChoiceChips name="facilities" legend={t("facilities")} defaultValue={defaults.facilities ?? []} options={FACILITIES.map((f) => ({ value: f, label: v(`facility.${f}`) }))} />

      {editing && canEditSettings ? (
        <fieldset className="flex flex-col gap-4 rounded-xl border border-line p-4">
          <legend className="px-1 font-display text-lg font-semibold">{t("bookingSettings")}</legend>
          {defaults.verification_status !== "verified" ? <Alert tone="info">{t("verificationRequired")}</Alert> : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField name="booking_mode" label={t("bookingMode")}>
              {(a) => (
                <Select {...a} defaultValue={defaults.booking_mode ?? "contact_only"}>
                  <option value="contact_only">{t("modeContact")}</option>
                  <option value="platform">{t("modePlatform")}</option>
                </Select>
              )}
            </FormField>
            <FormField name="buffer_minutes" label={t("buffer")} hint={t("bufferHint")}>
              {(a) => <Input {...a} type="number" min={0} max={60} step={5} defaultValue={defaults.buffer_minutes ?? 0} />}
            </FormField>
            <FormField name="min_notice_minutes" label={t("minNotice")}>
              {(a) => <Input {...a} type="number" min={0} max={10080} step={15} defaultValue={defaults.min_notice_minutes ?? 60} />}
            </FormField>
            <FormField name="max_advance_days" label={t("maxAdvance")}>
              {(a) => <Input {...a} type="number" min={1} max={180} defaultValue={defaults.max_advance_days ?? 30} />}
            </FormField>
            <FormField name="cancellation_deadline_hours" label={t("cancellationDeadline")}>
              {(a) => <Input {...a} type="number" min={0} max={168} defaultValue={defaults.cancellation_deadline_hours ?? 12} />}
            </FormField>
          </div>
          <Checkbox name="auto_confirm" defaultChecked={defaults.auto_confirm_bookings} label={t("autoConfirm")} />
          <FormField name="cancellation_policy" label={t("cancellationPolicy")}>
            {(a) => <Textarea {...a} defaultValue={defaults.cancellation_policy ?? ""} maxLength={1000} />}
          </FormField>
        </fieldset>
      ) : null}
      <SubmitButton size="lg" className="self-start">{editing ? t("save") : t("create")}</SubmitButton>
    </ActionForm>
  );
}
