import texts from "./site-texts.json";

const errors = texts.errors as Record<string, string>;
const validation = texts.validation as Record<string, string>;

/** The site's wording for an error code from the site or the database (scripts/sync-texts.mjs). */
export function errorText(code: string | null | undefined): string {
  if (!code) return errors.generic;
  if (code === "network") return "لا يوجد اتصال بالإنترنت. تحقّق من الشبكة ثم أعد المحاولة.";
  return errors[code] ?? validation[code] ?? errors.generic;
}

/** A field's own message (invalid_phone, required…). */
export const fieldText = (code: string) => validation[code] ?? errors[code] ?? errors.generic;

/** The code a failed database call carries (the functions raise named codes, as on the site). */
export function dbCode(error: { message?: string; code?: string } | null | undefined): string {
  if (!error) return "generic";
  if (error.code === "42501") return "forbidden";
  if (error.code === "PGRST202") return "feature_not_ready";
  return error.message && /^[a-z][a-z0-9_]{2,60}$/.test(error.message) ? error.message : "generic";
}
