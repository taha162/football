/**
 * Reading the WhatsApp bot's settings as they were pasted into the hosting
 * dashboard. The number may come as "+964 770 …", "0770…" or a wa.me link;
 * the bot's address loses any path. Pure, so it is unit-tested.
 */
import { normalizePhone } from "./phone";

export type WhatsappSettingsProblem =
  | "secret_missing"
  | "secret_short"
  | "number_missing"
  | "number_invalid"
  | "url_missing"
  | "url_invalid"
  | "url_insecure";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function readWhatsappSettings(
  rawSecret: string | undefined,
  rawNumber: string | undefined,
  rawUrl: string | undefined,
): { secret: string; number: string; url: string; problems: WhatsappSettingsProblem[] } {
  const problems: WhatsappSettingsProblem[] = [];

  const secret = (rawSecret ?? "").trim();
  if (!secret) problems.push("secret_missing");
  else if (secret.length < 32 || /\s/.test(secret)) problems.push("secret_short");

  const numberInput = (rawNumber ?? "").trim().replace(/^(?:https?:\/\/)?(?:wa\.me|api\.whatsapp\.com\/send\?phone=)\/?/i, "");
  const number = numberInput ? (normalizePhone(numberInput) ?? "") : "";
  if (!numberInput) problems.push("number_missing");
  else if (!number) problems.push("number_invalid");

  let url = "";
  const urlInput = (rawUrl ?? "").trim();
  if (!urlInput) {
    problems.push("url_missing");
  } else {
    try {
      const u = new URL(/^https?:\/\//i.test(urlInput) ? urlInput : `https://${urlInput}`);
      url = u.origin;
      // The secret travels with every request: only over https, except to this machine.
      if (u.protocol === "http:" && !LOCAL_HOSTS.has(u.hostname)) problems.push("url_insecure");
    } catch {
      problems.push("url_invalid");
    }
  }
  return { secret, number, url, problems };
}

/** Verification needs the secret and the number; sending also needs the bot's address. */
export const isVerifyProblem = (p: WhatsappSettingsProblem) => p.startsWith("secret") || p.startsWith("number");
