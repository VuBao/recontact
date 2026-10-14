import { createMimeMessage } from "mimetext/browser";

import { gmailHttpError, MailProviderError } from "./errors.js";

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const SEND_ENDPOINT = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
const LIST_ENDPOINT = "https://gmail.googleapis.com/gmail/v1/users/me/messages";
const UNSAFE_HEADER_CHARACTERS = /[\r\n\0]/;
const SIMPLE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const REQUIRED_CONFIG = [
  "MAIL_FROM_EMAIL",
  "MAIL_FROM_NAME",
  "GMAIL_CLIENT_ID",
  "GMAIL_CLIENT_SECRET",
  "GMAIL_REFRESH_TOKEN"
];

function requireConfiguration(env) {
  for (const field of REQUIRED_CONFIG) {
    if (typeof env[field] !== "string" || !env[field].trim()) {
      throw new MailProviderError("MAIL_PROVIDER_NOT_CONFIGURED", 503);
    }
  }
}

function requireSafeHeader(value) {
  return typeof value === "string" && value.trim() && !UNSAFE_HEADER_CHARACTERS.test(value);
}

function requireMailbox(mailbox) {
  return mailbox
    && requireSafeHeader(mailbox.email)
    && SIMPLE_EMAIL.test(mailbox.email.trim())
    && (mailbox.name == null || requireSafeHeader(mailbox.name));
}

function bytesToBase64(bytes) {
  const array = bytes instanceof Uint8Array
    ? bytes
    : bytes instanceof ArrayBuffer
      ? new Uint8Array(bytes)
      : null;
  if (!array) throw new MailProviderError("PROVIDER_REJECTED", 400);

  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < array.length; offset += chunkSize) {
    binary += String.fromCharCode(...array.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function wrapBase64(value) {
  return value.match(/.{1,76}/g)?.join("\r\n") ?? "";
}

function validateMessage(message, env) {
  if (!message || !requireMailbox(message.from) || !requireMailbox(message.to)) {
    throw new MailProviderError("PROVIDER_REJECTED", 400);
  }
  if (message.from.email.trim().toLowerCase() !== env.MAIL_FROM_EMAIL.trim().toLowerCase()) {
    throw new MailProviderError("PROVIDER_REJECTED", 400);
  }
  if (message.from.name?.trim() !== env.MAIL_FROM_NAME.trim()) {
    throw new MailProviderError("PROVIDER_REJECTED", 400);
  }
  if (!requireSafeHeader(message.subject) || typeof message.text !== "string" || message.text.includes("\0")) {
    throw new MailProviderError("PROVIDER_REJECTED", 400);
  }
  if (!Array.isArray(message.attachments ?? [])) throw new MailProviderError("PROVIDER_REJECTED", 400);
  for (const attachment of message.attachments ?? []) {
    if (!requireSafeHeader(attachment?.filename) || !requireSafeHeader(attachment?.contentType)) {
      throw new MailProviderError("PROVIDER_REJECTED", 400);
    }
    if (!(attachment.bytes instanceof Uint8Array) && !(attachment.bytes instanceof ArrayBuffer)) {
      throw new MailProviderError("PROVIDER_REJECTED", 400);
    }
  }
}

function buildMimeMessage(message, encodeAttachment) {
  try {
    const mime = createMimeMessage();
    mime.setSender({ addr: message.from.email.trim(), name: message.from.name?.trim() });
    mime.setRecipient({ addr: message.to.email.trim(), name: message.to.name?.trim(), type: "To" });
    mime.setSubject(message.subject.trim());
    mime.addMessage({ contentType: "text/plain", data: message.text });
    for (const attachment of message.attachments ?? []) {
      mime.addAttachment({
        filename: attachment.filename.trim(),
        contentType: attachment.contentType.trim(),
        data: encodeAttachment(attachment)
      });
    }
    return mime.asEncoded();
  } catch (error) {
    if (error instanceof MailProviderError) throw error;
    throw new MailProviderError("PROVIDER_REJECTED", 400);
  }
}

async function safeFetch(fetchImpl, url, options) {
  try {
    return await fetchImpl(url, options);
  } catch {
    throw new MailProviderError("PROVIDER_UNAVAILABLE", 503);
  }
}

export function createGmailProvider(env = {}, { fetchImpl = globalThis.fetch, now = () => Date.now() } = {}) {
  requireConfiguration(env);
  if (typeof fetchImpl !== "function") throw new MailProviderError("MAIL_PROVIDER_NOT_CONFIGURED", 503);

  let cachedToken = null;
  let tokenExpiresAt = 0;
  let tokenRefreshPromise = null;
  const encodedAttachmentCache = new WeakMap();

  function encodeAttachment(attachment) {
    const cached = encodedAttachmentCache.get(attachment);
    if (cached) return cached;
    const encoded = wrapBase64(bytesToBase64(attachment.bytes));
    encodedAttachmentCache.set(attachment, encoded);
    return encoded;
  }

  async function refreshAccessToken() {
    const body = new URLSearchParams({
      client_id: env.GMAIL_CLIENT_ID,
      client_secret: env.GMAIL_CLIENT_SECRET,
      refresh_token: env.GMAIL_REFRESH_TOKEN,
      grant_type: "refresh_token"
    });
    const response = await safeFetch(fetchImpl, TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString()
    });
    if (!response.ok) throw new MailProviderError("PROVIDER_AUTH_FAILED", 401);

    let result;
    try {
      result = await response.json();
    } catch {
      throw new MailProviderError("PROVIDER_AUTH_FAILED", 401);
    }
    if (typeof result.access_token !== "string" || !result.access_token) {
      throw new MailProviderError("PROVIDER_AUTH_FAILED", 401);
    }
    cachedToken = result.access_token;
    const expiresIn = Number.isFinite(Number(result.expires_in)) ? Number(result.expires_in) : 3600;
    tokenExpiresAt = now() + Math.max(0, expiresIn - 60) * 1000;
    return cachedToken;
  }

  function accessToken() {
    if (cachedToken && now() < tokenExpiresAt) return Promise.resolve(cachedToken);
    if (tokenRefreshPromise) return tokenRefreshPromise;
    tokenRefreshPromise = refreshAccessToken().finally(() => {
      tokenRefreshPromise = null;
    });
    return tokenRefreshPromise;
  }

  async function send(message) {
    validateMessage(message, env);
    const raw = buildMimeMessage(message, encodeAttachment);
    const token = await accessToken();
    const response = await safeFetch(fetchImpl, SEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ raw })
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        cachedToken = null;
        tokenExpiresAt = 0;
      }
      throw gmailHttpError(response.status);
    }

    let result;
    try {
      result = await response.json();
    } catch {
      throw new MailProviderError("UNKNOWN_SEND_ERROR", 500);
    }
    if (typeof result.id !== "string" || !result.id) throw new MailProviderError("UNKNOWN_SEND_ERROR", 500);
    return { messageId: result.id };
  }

  return Object.freeze({ send });
}

function readerConfiguration(env) {
  return ["GMAIL_CLIENT_ID", "GMAIL_CLIENT_SECRET", "GMAIL_REFRESH_TOKEN"]
    .every(field => typeof env[field] === "string" && env[field].trim());
}

function decodeBase64Url(value) {
  if (!value) return "";
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  try {
    const binary = atob(normalized);
    return new TextDecoder().decode(Uint8Array.from(binary, character => character.charCodeAt(0)));
  } catch { return ""; }
}

function collectPlainText(payload, output = []) {
  if (!payload) return output;
  if (payload.mimeType === "text/plain" && payload.body?.data) output.push(decodeBase64Url(payload.body.data));
  for (const part of payload.parts || []) collectPlainText(part, output);
  return output;
}

function header(headers, name) {
  return (headers || []).find(item => String(item.name).toLowerCase() === name)?.value || "";
}

export function createGmailReader(env = {}, { fetchImpl = globalThis.fetch, now = () => Date.now() } = {}) {
  if (!readerConfiguration(env) || typeof fetchImpl !== "function") return null;
  let cachedToken = null;
  let tokenExpiresAt = 0;
  let tokenRefreshPromise = null;
  async function accessToken() {
    if (cachedToken && now() < tokenExpiresAt) return cachedToken;
    if (tokenRefreshPromise) return tokenRefreshPromise;
    tokenRefreshPromise = (async () => {
      const body = new URLSearchParams({ client_id: env.GMAIL_CLIENT_ID, client_secret: env.GMAIL_CLIENT_SECRET, refresh_token: env.GMAIL_REFRESH_TOKEN, grant_type: "refresh_token" });
      const response = await fetchImpl(TOKEN_ENDPOINT, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: body.toString() });
      if (!response.ok) throw new MailProviderError("PROVIDER_AUTH_FAILED", 401);
      const result = await response.json().catch(() => ({}));
      if (!result.access_token) throw new MailProviderError("PROVIDER_AUTH_FAILED", 401);
      cachedToken = result.access_token;
      tokenExpiresAt = now() + Math.max(0, Number(result.expires_in || 3600) - 60) * 1000;
      return cachedToken;
    })().finally(() => { tokenRefreshPromise = null; });
    return tokenRefreshPromise;
  }
  async function request(url) {
    const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${await accessToken()}` } });
    if (!response.ok) throw gmailHttpError(response.status);
    return response.json();
  }
  return Object.freeze({
    async recentMessages() {
      const list = await request(`${LIST_ENDPOINT}?maxResults=50&q=${encodeURIComponent("in:anywhere newer_than:30d")}`);
      const messages = [];
      for (const item of list.messages || []) {
        const message = await request(`${LIST_ENDPOINT}/${encodeURIComponent(item.id)}?format=full`);
        const text = collectPlainText(message.payload).join("\n");
        messages.push({
          id: message.id,
          from: header(message.payload?.headers, "from"),
          receivedAt: message.internalDate ? new Date(Number(message.internalDate)).toISOString() : new Date().toISOString(),
          text
        });
      }
      return messages;
    }
  });
}
