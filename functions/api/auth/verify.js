import { authCookie, authCookies, configuredAuth, createSession, verifyChallenge, isStaffEmail } from "../../lib/auth.js";

export async function onRequestPost(context) {
  if (!configuredAuth(context.env)) return Response.json({ error: "Application login is not configured." }, { status: 503 });
  const body = await context.request.json().catch(() => ({}));
  const email = String(body.email || "").trim().toLowerCase();
  const otp = String(body.otp || "").trim();
  const cookieHeader = context.request.headers.get("Cookie") || "";
  const challenge = cookieHeader.split(/;\s*/).find(item => item.startsWith(`${authCookies.CHALLENGE_COOKIE}=`))?.slice(authCookies.CHALLENGE_COOKIE.length + 1);
  if (!isStaffEmail(email, context.env) || !/^\d{6}$/.test(otp) || !(await verifyChallenge(challenge && decodeURIComponent(challenge), email, otp, context.env))) {
    return Response.json({ error: "Mã đăng nhập không đúng hoặc đã hết hạn." }, { status: 401 });
  }
  const session = await createSession(email, context.env);
  const headers = new Headers({ "Content-Type": "application/json" });
  headers.append("Set-Cookie", authCookie(authCookies.SESSION_COOKIE, session, authCookies.SESSION_TTL_SECONDS));
  headers.append("Set-Cookie", authCookie(authCookies.CHALLENGE_COOKIE, "", 0));
  return new Response(JSON.stringify({ authenticated: true }), { headers });
}
