/**
 * Enough of an e-mail address or phone number for an admin to recognise it,
 * not to read it whole: "a***@gmail.com", "+96477***23". Used in security
 * alerts (src/lib/throttle.ts); the logs carry a hash-based tag instead.
 */
export function maskAccount(value: string): string {
  const v = value.trim().toLowerCase();
  const at = v.indexOf("@");
  if (at > 0) return `${v[0]}***${v.slice(at)}`;
  const digits = v.replace(/\D/g, "");
  return digits.length >= 7 ? `+${digits.slice(0, 5)}***${digits.slice(-2)}` : "***";
}
