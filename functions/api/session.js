import { authorized, clearSessionCookie, createSessionCookie, validAdminToken } from "../lib/auth.js";

export async function onRequestGet(context) {
  const authenticated = await authorized(context.request, context.env);
  return Response.json({ authenticated }, { status: authenticated ? 200 : 401 });
}

export async function onRequestPost(context) {
  if (!context.env.ADMIN_TOKEN) return Response.json({ error: "ADMIN_TOKEN is not configured." }, { status: 503 });
  const body = await context.request.json();
  if (!validAdminToken(body.token, context.env)) {
    return Response.json({ error: "Mã truy cập không đúng." }, { status: 401 });
  }

  return Response.json({ authenticated: true }, {
    headers: { "Set-Cookie": await createSessionCookie(context.env) }
  });
}

export function onRequestDelete() {
  return Response.json({ authenticated: false }, {
    headers: { "Set-Cookie": clearSessionCookie() }
  });
}
