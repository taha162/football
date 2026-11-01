/**
 * Reading the bot's settings as they were pasted into the hosting dashboard.
 * Copying from a phone often brings spaces, a line break, an "@" or the whole
 * t.me link along, so those are tolerated. Pure, so it is unit-tested.
 */

export type BotSettingsProblem = "token_missing" | "token_invalid" | "username_missing" | "username_invalid";

export function readBotSettings(
  rawToken: string | undefined,
  rawUsername: string | undefined,
): { token: string; username: string; problems: BotSettingsProblem[] } {
  const token = (rawToken ?? "").trim();
  const username = (rawUsername ?? "")
    .trim()
    .replace(/^(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me)\//i, "")
    .replace(/^@/, "")
    .replace(/[/?#].*$/, "");
  const problems: BotSettingsProblem[] = [];
  if (!token) problems.push("token_missing");
  else if (!/^\d{5,}:[\w-]{20,}$/.test(token)) problems.push("token_invalid");
  if (!username) problems.push("username_missing");
  else if (!/^[A-Za-z]\w{4,31}$/.test(username)) problems.push("username_invalid");
  return { token, username, problems };
}
