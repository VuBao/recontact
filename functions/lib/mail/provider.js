import { MailProviderError } from "./errors.js";
import { createGmailProvider } from "./gmail.js";

export function createMailProvider(env = {}, options = {}) {
  const provider = typeof env.MAIL_PROVIDER === "string" ? env.MAIL_PROVIDER.trim().toLowerCase() : "";
  if (!provider) throw new MailProviderError("MAIL_PROVIDER_NOT_CONFIGURED", 503);
  if (provider !== "gmail") throw new MailProviderError("MAIL_PROVIDER_UNSUPPORTED", 503);
  return createGmailProvider(env, options);
}
