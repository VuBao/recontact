const cookieName = "recontact_session";
const sessionLifetimeSeconds = 60 * 60 * 24 * 365;

function bytesToHex(bytes) {
  return [...bytes].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function safeEqual(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

async function signature(secret, expiresAt) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signed = await crypto.subtle.sign("HMAC", key, encoder.encode(`recontact:${expiresAt}`));
  return bytesToHex(new Uint8Array(signed));
}

function readCookie(request) {
  const header = request.headers.get("Cookie") || "";
  const item = header.split(";").map(value => value.trim()).find(value => value.startsWith(`${cookieName}=`));
  return item ? decodeURIComponent(item.slice(cookieName.length + 1)) : "";
}

export async function authorized(request, env) {
  if (!env.ADMIN_TOKEN) return false;
  if (safeEqual(request.headers.get("Authorization") || "", `Bearer ${env.ADMIN_TOKEN}`)) return true;

  const [expiresAtText, suppliedSignature] = readCookie(request).split(".");
  const expiresAt = Number(expiresAtText);
  if (!expiresAt || expiresAt <= Math.floor(Date.now() / 1000) || !suppliedSignature) return false;
  const expectedSignature = await signature(env.ADMIN_TOKEN, expiresAtText);
  return safeEqual(suppliedSignature, expectedSignature);
}

export function validAdminToken(token, env) {
  return Boolean(env.ADMIN_TOKEN) && safeEqual(String(token || ""), env.ADMIN_TOKEN);
}

export async function createSessionCookie(env) {
  const expiresAt = Math.floor(Date.now() / 1000) + sessionLifetimeSeconds;
  const value = `${expiresAt}.${await signature(env.ADMIN_TOKEN, String(expiresAt))}`;
  return `${cookieName}=${encodeURIComponent(value)}; Max-Age=${sessionLifetimeSeconds}; Path=/; HttpOnly; Secure; SameSite=Strict`;
}

export function clearSessionCookie() {
  return `${cookieName}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict`;
}
