/**
 * What an authenticator app computes (RFC 6238: HMAC-SHA1, 6 digits, 30-second
 * steps), so tests can turn on two-step verification and sign in with it.
 */
import { createHmac } from "node:crypto";

/** RFC 4648 base32, the form apps are given the secret in, to bytes. */
function base32(secret: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of secret.replace(/[\s=]/g, "").toUpperCase()) {
    const v = alphabet.indexOf(c);
    if (v < 0) throw new Error(`not base32: ${c}`);
    bits += v.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

/** The code the app shows for `secret` at time `at` (ms). */
export function totp(secret: string, at = Date.now(), digits = 6): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const h = createHmac("sha1", base32(secret)).update(counter).digest();
  const o = h[h.length - 1] & 0x0f;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 10 ** digits).padStart(digits, "0");
}

/** A code no app would accept now: none of the current, previous or next step's. */
export function wrongCode(secret: string): string {
  const near = new Set([-30_000, 0, 30_000].map((d) => totp(secret, Date.now() + d)));
  let n = 123_456;
  while (near.has(String(n))) n = (n + 1) % 1_000_000;
  return String(n).padStart(6, "0");
}

/** The current code, waiting for the next step when this one was already used. */
export async function freshCode(secret: string, used: Set<string>): Promise<string> {
  for (;;) {
    const code = totp(secret);
    if (!used.has(code)) {
      used.add(code);
      return code;
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
}
