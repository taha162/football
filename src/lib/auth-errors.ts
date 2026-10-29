/**
 * Maps Supabase Auth errors to the stable codes the forms translate
 * (messages.errors.<code>). Pure, so the mapping is unit-tested.
 */
export interface AuthErrorLike {
  message?: string;
  status?: number;
  code?: string;
}

export type EmailDeliveryError = "resend_too_soon" | "email_limit_reached" | "email_not_authorized" | "email_send_failed";

/**
 * Why an auth e-mail (sign-up code, new code, password reset) was not sent,
 * or null when the error is about something else.
 */
export function emailDeliveryError(error: AuthErrorLike): EmailDeliveryError | null {
  const message = error.message ?? "";
  if (error.code === "over_email_send_rate_limit") {
    // "…you can only request this after N seconds" is the pause between two
    // e-mails to one address; otherwise the project's hourly allowance ran out.
    return /after \d+ seconds?/i.test(message) ? "resend_too_soon" : "email_limit_reached";
  }
  // Supabase's built-in mail service only writes to the project's own team.
  if (error.code === "email_address_not_authorized") return "email_not_authorized";
  // The mail server failed: "Error sending confirmation email", "…recovery email".
  if ((error.status ?? 0) >= 500 && /error sending/i.test(message)) return "email_send_failed";
  return null;
}

export function authErrorCode(error: AuthErrorLike): string {
  const delivery = emailDeliveryError(error);
  if (delivery) return delivery;
  if (error.code === "user_already_exists" || error.code === "email_exists") return "email_taken";
  const m = (error.message ?? "").toLowerCase();
  if (m.includes("invalid login") || m.includes("invalid credentials")) return "invalid_credentials";
  if (m.includes("email not confirmed")) return "email_not_confirmed";
  if (m.includes("already registered") || m.includes("already been registered")) return "email_taken";
  if (m.includes("weak") || m.includes("password should")) return "weak_password";
  if (error.status === 429 || m.includes("rate limit")) return "rate_limited";
  return "auth_failed";
}
