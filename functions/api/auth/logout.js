import { authCookie, authCookies } from "../../lib/auth.js";

export function onRequestPost() {
  return new Response(JSON.stringify({ logged_out: true }), {
    headers: { "Content-Type": "application/json", "Set-Cookie": authCookie(authCookies.SESSION_COOKIE, "", 0) }
  });
}
