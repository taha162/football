/**
 * Username rules, as the database checks them (private.valid_username,
 * migration 0041): 3 to 20 characters, lower-case English letters, digits,
 * «_» and «.», starting with a letter, without «..» and not ending with «.»,
 * and not one of a few reserved words. Here for quick answers on the form;
 * the database has the last word.
 */
const RESERVED = new Set([
  "admin", "administrator", "admins", "support", "help", "moderator", "moderators", "mod", "system",
  "root", "official", "almalab", "al_malab", "al.malab", "malab", "staff", "security", "info",
  "contact", "null", "undefined", "player", "players", "user", "users", "me", "friends",
]);

/** What was typed, as stored: no spaces or leading «@», lower case. */
export function normalizeUsername(raw: string): string {
  return raw.trim().replace(/^@+/, "").replace(/\s+/g, "").toLowerCase();
}

export function isValidUsername(name: string): boolean {
  return /^[a-z][a-z0-9_.]{2,19}$/.test(name) && !name.includes("..") && !name.endsWith(".") && !RESERVED.has(name);
}

export type UsernameStatus = "ok" | "invalid" | "taken" | "unknown";
