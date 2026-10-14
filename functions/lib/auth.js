const SESSION_COOKIE = "recontact_session";
const CHALLENGE_COOKIE = "recontact_challenge";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 365;
const CHALLENGE_TTL_SECONDS = 10 * 60;

function base64UrlEncode(value) {
  const bytes = value instanceof Uint8Array ? value : new TextEncoder().encode(value);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value) {
  try {
    const normalized = String(value).replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(String(value).length / 4) * 4, "=");
    const binary = atob(normalized);
    return Uint8Array.from(binary, char => char.charCodeAt(0));
  } catch { return null; }
}

async function sign(value, secret) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return base64UrlEncode(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value))));
}

async function token(payload, secret) {
  const body = base64UrlEncode(JSON.stringify(payload));
  return `${body}.${await sign(body, secret)}`;
}

async function readToken(value, secret) {
  if (!secret || typeof value !== "string") return null;
  const [body, signature] = value.split(".");
  if (!body || !signature || signature !== await sign(body, secret)) return null;
  const bytes = base64UrlDecode(body);
  if (!bytes) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(bytes));
    return Number(payload.exp) > Math.floor(Date.now() / 1000) ? payload : null;
  } catch { return null; }
}

function cookies(request) {
  return Object.fromEntries((request.headers.get("Cookie") || "").split(/;\s*/).filter(Boolean).map(item => {
    const index = item.indexOf("=");
    return index < 0 ? [item, ""] : [item.slice(0, index), decodeURIComponent(item.slice(index + 1))];
  }));
}

function staffEmails(env) {
  return String(env.APP_AUTH_EMAILS || "").split(",").map(value => value.trim().toLowerCase()).filter(Boolean);
}

export function configuredAuth(env = {}) {
  return Boolean(String(env.APP_SESSION_SECRET || "").trim() && staffEmails(env).length);
}

export function isStaffEmail(email, env = {}) {
  return staffEmails(env).includes(String(email || "").trim().toLowerCase());
}

export function randomOtp() {
  return String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, "0");
}

export async function hashOtp(email, otp, secret) {
  const bytes = new TextEncoder().encode(`${email.toLowerCase()}\0${otp}\0${secret}`);
  return base64UrlEncode(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
}

export async function createChallenge(email, otp, env = {}) {
  const now = Math.floor(Date.now() / 1000);
  return token({ type: "challenge", email: email.toLowerCase(), otp_hash: await hashOtp(email, otp, env.APP_SESSION_SECRET), exp: now + CHALLENGE_TTL_SECONDS }, env.APP_SESSION_SECRET);
}

export async function verifyChallenge(value, email, otp, env = {}) {
  const payload = await readToken(value, env.APP_SESSION_SECRET);
  if (!payload || payload.type !== "challenge" || payload.email !== String(email).trim().toLowerCase()) return false;
  return payload.otp_hash === await hashOtp(email, otp, env.APP_SESSION_SECRET);
}

export async function createSession(email, env = {}) {
  const now = Math.floor(Date.now() / 1000);
  return token({ type: "session", email: email.toLowerCase(), iat: now, exp: now + SESSION_TTL_SECONDS }, env.APP_SESSION_SECRET);
}

export async function sessionFromRequest(request, env = {}) {
  const value = cookies(request)[SESSION_COOKIE];
  const payload = await readToken(value, env.APP_SESSION_SECRET);
  return payload?.type === "session" && isStaffEmail(payload.email, env) ? payload : null;
}

export async function authorized(request, env = {}) {
  const hostname = new URL(request.url).hostname;
  if (hostname === "127.0.0.1" || hostname === "localhost") return true;
  if (request.headers.get("Cf-Access-Jwt-Assertion")) return true;
  return Boolean(await sessionFromRequest(request, env));
}

export function authCookie(name, value, maxAge) {
  return `${name}=${encodeURIComponent(value)}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

export const authCookies = { SESSION_COOKIE, CHALLENGE_COOKIE, SESSION_TTL_SECONDS, CHALLENGE_TTL_SECONDS };
