/**
 * Two-step verification checks shared by the proxy, sign-in and pages. Pure
 * (no server-only imports), so the proxy can use it and it is unit-tested.
 */

interface WithFactors {
  factors?: Array<{ status: string }> | null;
}

/** Whether the person confirmed an authenticator app (an unfinished set-up doesn't count). */
export function hasSecondFactor(user: WithFactors | null | undefined): boolean {
  return Boolean(user?.factors?.some((f) => f.status === "verified"));
}

/** Where to go once the code is accepted: the page asked for, never the code page itself. */
export function afterSecondStep(next: string): string {
  return /^\/mfa\/?(?:[?#]|$)/.test(next) ? "/dashboard" : next;
}

/** Pages open to someone who passed the password but not yet the code: only the code page. */
export function needsSecondStep(user: WithFactors | null | undefined, currentLevel: string | null | undefined, path: string): boolean {
  if (!hasSecondFactor(user) || currentLevel === "aal2") return false;
  return !/^\/mfa\/?$/.test(path);
}
