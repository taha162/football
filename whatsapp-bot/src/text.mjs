/**
 * How a WhatsApp message is read: does it carry a verification code, or ask
 * to stop messages? The bot and the site read messages the same way (the site
 * imports this file). Pure: no WhatsApp library here.
 */

/**
 * Arabic-Indic and Persian digits as ASCII digits ("٠٧٧٠" → "0770").
 * @param {unknown} text
 * @returns {string}
 */
export function asciiDigits(text) {
  return String(text ?? "").replace(/[٠-٩۰-۹]/g, (d) => {
    const c = d.charCodeAt(0);
    return String(c >= 0x06f0 ? c - 0x06f0 : c - 0x0660);
  });
}

/** The code alphabet: no 0, O, 1, I or L, which are easy to confuse. */
export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** XXXX-XXXX from the code alphabet, alone or inside other text; the dash may be a space or missing. */
const CODE_IN_TEXT = /(?:^|[^A-Z0-9])([A-HJKMNP-Z2-9]{4})[- _]?([A-HJKMNP-Z2-9]{4})(?![A-Z0-9])/;

/**
 * The first code-shaped token in a message ("رمزي abcd efgh" → "ABCD-EFGH"), or null.
 * @param {unknown} text
 * @returns {string | null}
 */
export function findCode(text) {
  const m = CODE_IN_TEXT.exec(asciiDigits(text).toUpperCase());
  return m ? `${m[1]}-${m[2]}` : null;
}

/** Messages that stop every WhatsApp message to the sender (compared after normalizing). */
const STOP_WORDS = new Set(["0", "stop", "unsubscribe", "الغاء", "الغاء الاشتراك", "ايقاف"]);

/**
 * "0", "stop" or «إلغاء», alone in the message: stop all messages to this number.
 * @param {unknown} text
 * @returns {boolean}
 */
export function isStopKeyword(text) {
  const t = asciiDigits(text)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, "") // harakat and tatweel
    .replace(/[إأآ]/g, "ا")
    .replace(/[\s.,!?؟،؛:;"'«»()[\]{}*_-]+/g, " ")
    .trim();
  return STOP_WORDS.has(t);
}
