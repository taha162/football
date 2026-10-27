/**
 * Money is always an integer number of the currency's storage unit.
 * The storage unit is defined per currency in the `currencies` table
 * (IQD: exponent 0, i.e. whole dinars). Never use floating point for
 * amounts that are stored or compared.
 */

export const CURRENCY_EXPONENTS: Record<string, number> = {
  IQD: 0,
  USD: 2,
};

export function exponentOf(currency: string): number {
  return CURRENCY_EXPONENTS[currency] ?? 0;
}

/**
 * Per-player share of a total cost. Uses ceiling division so the collector
 * never ends up short. Mirrors `private.split_cost` in the database.
 */
export function splitCost(total: number | null | undefined, payingPlayers: number | null | undefined): number | null {
  if (total == null || payingPlayers == null || payingPlayers <= 0) return null;
  assertSafeInteger(total, "total");
  assertSafeInteger(payingPlayers, "payingPlayers");
  if (total < 0) throw new RangeError("total must be >= 0");
  return Math.floor((total + payingPlayers - 1) / payingPlayers);
}

/** Amount collected beyond the total when every paying player pays the share. */
export function costSurplus(total: number, payingPlayers: number): number {
  const share = splitCost(total, payingPlayers);
  return share == null ? 0 : share * payingPlayers - total;
}

/** Price for a booking duration; mirrors `private.price_for_duration` (round half up). */
export function priceForDuration(hourlyPrice: number, minutes: number): number {
  assertSafeInteger(hourlyPrice, "hourlyPrice");
  assertSafeInteger(minutes, "minutes");
  return Math.floor((hourlyPrice * minutes + 30) / 60);
}

export function formatMoney(amount: number, currency: string, locale: string): string {
  const exponent = exponentOf(currency);
  const value = amount / 10 ** exponent;
  return new Intl.NumberFormat(locale === "ar" ? "ar-IQ" : "en-IQ", {
    style: "currency",
    currency,
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent,
  }).format(value);
}

/** Parses user input (in display units) into storage units; returns null if invalid. */
export function parseMoneyInput(input: string, currency: string): number | null {
  const normalized = toAsciiDigits(input).replace(/[,\s٬]/g, "").trim();
  if (normalized === "") return null;
  const exponent = exponentOf(currency);
  const pattern = exponent === 0 ? /^\d+$/ : new RegExp(`^\\d+(\\.\\d{1,${exponent}})?$`);
  if (!pattern.test(normalized)) return null;
  const [whole, frac = ""] = normalized.split(".");
  const value = Number(whole) * 10 ** exponent + Number(frac.padEnd(exponent, "0") || "0");
  return Number.isSafeInteger(value) ? value : null;
}

/** Converts Arabic-Indic and Eastern Arabic-Indic digits to ASCII digits. */
export function toAsciiDigits(input: string): string {
  return input
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/٫/g, ".");
}

function assertSafeInteger(value: number, name: string) {
  if (!Number.isSafeInteger(value)) throw new RangeError(`${name} must be a safe integer`);
}
