const SAFE_MESSAGES = Object.freeze({
  MAIL_PROVIDER_NOT_CONFIGURED: "Mail provider is not configured.",
  MAIL_PROVIDER_UNSUPPORTED: "Mail provider is not supported.",
  PROVIDER_AUTH_FAILED: "Mail provider authentication failed.",
  PROVIDER_RATE_LIMITED: "Mail provider rate limit exceeded.",
  PROVIDER_REJECTED: "Mail provider rejected the message.",
  PROVIDER_UNAVAILABLE: "Mail provider is temporarily unavailable.",
  UNKNOWN_SEND_ERROR: "Mail delivery failed."
});

export class MailProviderError extends Error {
  constructor(code, httpStatus = 500) {
    super(SAFE_MESSAGES[code] ?? SAFE_MESSAGES.UNKNOWN_SEND_ERROR);
    this.name = "MailProviderError";
    this.code = SAFE_MESSAGES[code] ? code : "UNKNOWN_SEND_ERROR";
    this.httpStatus = httpStatus;
  }
}

export function gmailHttpError(status) {
  if (status === 401 || status === 403) return new MailProviderError("PROVIDER_AUTH_FAILED", 401);
  if (status === 429) return new MailProviderError("PROVIDER_RATE_LIMITED", 429);
  if (status >= 500) return new MailProviderError("PROVIDER_UNAVAILABLE", 503);
  if (status >= 400) return new MailProviderError("PROVIDER_REJECTED", 400);
  return new MailProviderError("UNKNOWN_SEND_ERROR", 500);
}
