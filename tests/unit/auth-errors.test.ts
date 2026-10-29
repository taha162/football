import { describe, expect, it } from "vitest";
import { authErrorCode, emailDeliveryError } from "@/lib/auth-errors";

// Responses recorded from Supabase Auth (local stack), plus the hosted
// built-in mail service's refusal for addresses outside the project team.
const tooSoon = { status: 429, code: "over_email_send_rate_limit", message: "For security purposes, you can only request this after 37 seconds." };
const hourlyCap = { status: 429, code: "over_email_send_rate_limit", message: "email rate limit exceeded" };
const notTeam = { status: 400, code: "email_address_not_authorized", message: 'Email address "player@example.com" cannot be used as it is not authorized' };
const smtpDown = { status: 500, message: "Error sending confirmation email" };
const smtpDownReset = { status: 500, message: "Error sending recovery email" };

describe("auth e-mail delivery errors", () => {
  it("tells the pause between two e-mails apart from the hourly allowance running out", () => {
    expect(emailDeliveryError(tooSoon)).toBe("resend_too_soon");
    expect(emailDeliveryError(hourlyCap)).toBe("email_limit_reached");
  });

  it("recognises the built-in mail service refusing addresses outside the team, and a failing mail server", () => {
    expect(emailDeliveryError(notTeam)).toBe("email_not_authorized");
    expect(emailDeliveryError(smtpDown)).toBe("email_send_failed");
    expect(emailDeliveryError(smtpDownReset)).toBe("email_send_failed");
  });

  it("leaves errors that are not about e-mail alone", () => {
    expect(emailDeliveryError({ status: 400, code: "invalid_credentials", message: "Invalid login credentials" })).toBeNull();
    expect(emailDeliveryError({ status: 500, code: "unexpected_failure", message: "Database error saving new user" })).toBeNull();
    expect(emailDeliveryError({ status: 429, code: "over_request_rate_limit", message: "Request rate limit reached" })).toBeNull();
  });
});

describe("auth error codes", () => {
  it("puts e-mail delivery problems first, so sign-up never fails with a vague message", () => {
    expect(authErrorCode(notTeam)).toBe("email_not_authorized");
    expect(authErrorCode(smtpDown)).toBe("email_send_failed");
    expect(authErrorCode(hourlyCap)).toBe("email_limit_reached");
  });

  it("maps the usual sign-in and sign-up refusals", () => {
    expect(authErrorCode({ status: 422, code: "user_already_exists", message: "User already registered" })).toBe("email_taken");
    expect(authErrorCode({ status: 400, code: "invalid_credentials", message: "Invalid login credentials" })).toBe("invalid_credentials");
    expect(authErrorCode({ status: 400, code: "email_not_confirmed", message: "Email not confirmed" })).toBe("email_not_confirmed");
    expect(authErrorCode({ status: 422, code: "weak_password", message: "Password should contain at least one character of each" })).toBe("weak_password");
    expect(authErrorCode({ status: 429, code: "over_request_rate_limit", message: "Request rate limit reached" })).toBe("rate_limited");
    expect(authErrorCode({ status: 500, code: "unexpected_failure", message: "Database error saving new user" })).toBe("auth_failed");
  });
});
