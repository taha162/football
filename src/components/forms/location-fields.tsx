"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { FormField } from "@/components/ui/action-form";
import { Select } from "@/components/ui/field";

export interface CityOption {
  id: string;
  name_en: string;
  name_ar: string;
}
export interface AreaOption extends CityOption {
  city_id: string;
}

/** City + area selects; areas are filtered to the selected city. */
export function LocationFields({
  cities,
  areas,
  defaultCity,
  defaultArea,
  areaLabel,
  areaHint,
  required = true,
  cityName = "city_id",
  areaName = "area_id",
  allowAnyCity = false,
  onCityChange,
}: {
  cities: CityOption[];
  areas: AreaOption[];
  defaultCity?: string | null;
  defaultArea?: string | null;
  areaLabel?: string;
  areaHint?: string;
  required?: boolean;
  cityName?: string;
  areaName?: string;
  allowAnyCity?: boolean;
  /** Told when the person picks another city (a form showing that city's venues). */
  onCityChange?: (city: string) => void;
}) {
  const t = useTranslations("forms");
  const locale = useLocale();
  // No city assumed: with every governorate listed, people pick theirs (forms that know it pass it as the default).
  const [city, setCity] = useState(defaultCity ?? "");
  const name = (r: CityOption) => (locale === "ar" ? r.name_ar : r.name_en);
  const cityAreas = areas.filter((a) => a.city_id === city).sort((a, b) => name(a).localeCompare(name(b), locale));
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <FormField name={cityName} label={t("city")} required={required}>
        {(a) => (
          <Select
            {...a}
            value={city}
            onChange={(e) => {
              setCity(e.target.value);
              onCityChange?.(e.target.value);
            }}
            required={required}
          >
            {allowAnyCity ? (
              <option value="">{t("anyCity")}</option>
            ) : (
              <option value="" disabled>
                {t("chooseCity")}
              </option>
            )}
            {cities.map((c) => (
              <option key={c.id} value={c.id}>
                {name(c)}
              </option>
            ))}
          </Select>
        )}
      </FormField>
      <FormField name={areaName} label={areaLabel ?? t("area")} hint={areaHint}>
        {(a) => (
          <Select {...a} defaultValue={defaultArea ?? ""} key={city}>
            <option value="">{t("anyArea")}</option>
            {cityAreas.map((ar) => (
              <option key={ar.id} value={ar.id}>
                {name(ar)}
              </option>
            ))}
          </Select>
        )}
      </FormField>
    </div>
  );
}
