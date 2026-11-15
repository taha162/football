/**
 * The bot's settings, from environment variables. Pure, so it is unit-tested.
 * Nothing secret has a default; every pacing value has a safe one.
 */

export const DEFAULT_HELP =
  "هذا رقم «الملعب» للتحقق ورسائل الحجوزات. لإنشاء حساب أو استعادة كلمة المرور ابدأ من الموقع، ثم أرسل هنا الرمز الذي يظهر لك.";

/** When WhatsApp hides the sender's number (LID) and the session doesn't know it either. */
export const NO_NUMBER_CODE =
  "لم يظهر لنا رقم هاتفك في هذه المحادثة، فلا يمكن تأكيده من هنا. أكمل من الموقع بالبريد الإلكتروني أو تيليغرام.";
export const NO_NUMBER_STOP =
  "لم يظهر لنا رقم هاتفك في هذه المحادثة، فلم نستطع تسجيل طلب الإيقاف. أوقف الرسائل من إعدادات حسابك في الموقع.";
/** When the site can't be reached or refuses the bot. */
export const TROUBLE = "حدث خلل عندنا فلم نستطع قراءة رسالتك الآن. أرسلها مرة أخرى بعد دقائق.";

const LOCAL = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** The site's origin ("https://x.vercel.app/ar" → "https://x.vercel.app"), or null. */
export function siteOrigin(value) {
  const v = String(value ?? "").trim();
  if (!v) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`);
    if (u.protocol === "http:" && !LOCAL.has(u.hostname)) return null;
    return u.origin;
  } catch {
    return null;
  }
}

/**
 * @param {Record<string, string | undefined>} env
 */
export function readConfig(env) {
  const problems = [];
  const int = (name, fallback, min, max) => {
    const raw = env[name];
    const v = raw === undefined || raw === "" ? fallback : Number(raw);
    if (!Number.isInteger(v) || v < min || v > max) {
      problems.push(`${name} must be a whole number from ${min} to ${max}`);
      return fallback;
    }
    return v;
  };

  const secret = String(env.WHATSAPP_BOT_SECRET ?? "").trim();
  if (secret.length < 32 || /\s/.test(secret)) problems.push("WHATSAPP_BOT_SECRET must be at least 32 characters, without spaces (the same value as on the site)");
  const siteUrl = siteOrigin(env.SITE_URL);
  if (!siteUrl) problems.push("SITE_URL must be the site's https address, e.g. https://al-malab.vercel.app");
  const pairing = String(env.WA_PAIRING_NUMBER ?? "").replace(/\D/g, "");
  if (pairing && !/^[1-9]\d{7,14}$/.test(pairing)) problems.push("WA_PAIRING_NUMBER must be the full number with its country code, e.g. 9647701234567");

  const config = {
    secret,
    siteUrl: siteUrl ?? "",
    port: int("PORT", 8080, 1, 65535),
    dataDir: String(env.DATA_DIR || "/data"),
    pairingNumber: pairing || null,
    minDelayMs: int("SEND_MIN_DELAY_SECONDS", 8, 1, 600) * 1000,
    maxDelayMs: int("SEND_MAX_DELAY_SECONDS", 25, 1, 600) * 1000,
    maxPerHour: int("MAX_PER_HOUR", 30, 1, 1000),
    maxPerDay: int("MAX_PER_DAY", 200, 1, 10000),
    maxConsecutiveErrors: int("MAX_CONSECUTIVE_ERRORS", 3, 1, 50),
    pauseMinutes: int("PAUSE_MINUTES", 30, 1, 1440),
    maxQueue: int("MAX_QUEUE", 500, 10, 10000),
    inboundPerHour: int("INBOUND_PER_HOUR", 10, 1, 1000),
    helpText: String(env.HELP_TEXT || DEFAULT_HELP),
    noNumberCodeText: NO_NUMBER_CODE,
    noNumberStopText: NO_NUMBER_STOP,
    troubleText: TROUBLE,
    timeZone: "Asia/Baghdad",
    logLevel: String(env.LOG_LEVEL || "info"),
  };
  if (config.minDelayMs > config.maxDelayMs) problems.push("SEND_MIN_DELAY_SECONDS must not be more than SEND_MAX_DELAY_SECONDS");
  return { config, problems };
}
