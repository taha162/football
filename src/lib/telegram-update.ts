/**
 * Reading Telegram Bot API updates (https://core.telegram.org/bots/api#update)
 * for the verification bot. Pure functions, so they are unit-tested.
 */

export type BotInput =
  /** A verification code: from the start link (/start CODE) or typed. */
  | { kind: "code"; chatId: number; fromId: number; code: string }
  /** A contact card. `own` is true only when it is the sender's own number. */
  | { kind: "contact"; chatId: number; fromId: number; phone: string; own: boolean }
  /** Anything else in a private chat (a bare /start, other text, stickers…). */
  | { kind: "other"; chatId: number; fromId: number };

const CODE = /^([A-Z0-9]{4})[-_ ]?([A-Z0-9]{4})$/;
const CODE_IN_TEXT = /(?:^|[^A-Z0-9])([A-Z0-9]{4})[-_ ]?([A-Z0-9]{4})(?![A-Z0-9])/;

/** "abcd efgh", "ABCDEFGH" or "ABCD-EFGH" → "ABCD-EFGH"; null when it isn't one. */
export function normalizeCode(input: string): string | null {
  const m = CODE.exec(input.trim().toUpperCase());
  return m ? `${m[1]}-${m[2]}` : null;
}

function findCode(text: string): string | null {
  const upper = text.toUpperCase();
  const start = /^\/START(?:@\w+)?\s+(\S+)/.exec(upper);
  if (start) return normalizeCode(start[1]);
  const m = CODE_IN_TEXT.exec(upper);
  return m ? `${m[1]}-${m[2]}` : null;
}

const isId = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;

/**
 * What the bot was sent, or null for updates it ignores: anything that isn't
 * a new message in a private chat (edits, channel posts, group messages,
 * messages from bots, forwarded messages).
 */
export function readUpdate(update: unknown): BotInput | null {
  const message = (update as { message?: unknown } | null)?.message as
    | {
        chat?: { id?: unknown; type?: unknown };
        from?: { id?: unknown; is_bot?: unknown };
        text?: unknown;
        contact?: { phone_number?: unknown; user_id?: unknown };
        forward_origin?: unknown;
        forward_date?: unknown;
      }
    | undefined;
  if (!message || typeof message !== "object") return null;
  const chatId = message.chat?.id;
  const fromId = message.from?.id;
  if (message.chat?.type !== "private" || !isId(chatId) || !isId(fromId) || message.from?.is_bot === true) return null;
  if (message.forward_origin !== undefined || message.forward_date !== undefined) return null;

  if (message.contact && typeof message.contact.phone_number === "string") {
    const own = isId(message.contact.user_id) && message.contact.user_id === fromId;
    return { kind: "contact", chatId, fromId, phone: message.contact.phone_number.slice(0, 32), own };
  }
  if (typeof message.text === "string") {
    const code = findCode(message.text.slice(0, 500));
    if (code) return { kind: "code", chatId, fromId, code };
  }
  return { kind: "other", chatId, fromId };
}
