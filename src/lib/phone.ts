/**
 * Phone helpers. Numbers are stored as E.164 digits without "+" (the format
 * WhatsApp uses for senders, e.g. 9647701234567).
 */

/** Internal auth e-mail domain for WhatsApp-verified accounts (reserved TLD, never delivered). */
export const PHONE_ACCOUNT_DOMAIN = "phone.malaab.invalid";

export function isPhoneAccountEmail(email: string | null | undefined): boolean {
  return Boolean(email && email.toLowerCase().endsWith(`@${PHONE_ACCOUNT_DOMAIN}`));
}

/**
 * Normalizes user input to E.164 digits. Local Iraqi numbers (07xxxxxxxxx)
 * get the 964 country code; "+" and "00" prefixes are accepted.
 */
export function normalizePhone(input: string, defaultCountryCode = "964"): string | null {
  const ascii = input.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
  let digits = ascii.replace(/[^0-9+]/g, "");
  if (digits.startsWith("+")) digits = digits.slice(1);
  else if (digits.startsWith("00")) digits = digits.slice(2);
  else if (digits.startsWith("0")) digits = defaultCountryCode + digits.slice(1);
  digits = digits.replace(/\D/g, "");
  return /^[1-9][0-9]{7,14}$/.test(digits) ? digits : null;
}

/** True when the input looks like a phone number rather than an e-mail. */
export function looksLikePhone(input: string): boolean {
  return !input.includes("@") && /[0-9٠-٩۰-۹]{6,}/.test(input.replace(/[\s-]/g, ""));
}

/** "+964 770 ••• 4567" style display. */
export function maskPhone(phone: string): string {
  return `+${phone.slice(0, 3)} ${phone.slice(3, 6)} ••• ${phone.slice(-4)}`;
}
