import { authorized } from "../lib/auth.js";
import { ensureRole, normalizeRoleTitle, roleTitleKey } from "../lib/roles.js";


export async function onRequestGet(context) {
  if (!(await authorized(context.request, context.env))) return new Response("Unauthorized", { status: 401 });
  if (!context.env.DB) return Response.json({ error: "D1 binding DB is not configured." }, { status: 503 });

  const result = await context.env.DB.prepare(
    "SELECT id, title, title_key, location, status, created_at FROM jobs ORDER BY created_at DESC"
  ).all();
  return Response.json(result.results);
}

export async function onRequestPost(context) {
  if (!(await authorized(context.request, context.env))) return new Response("Unauthorized", { status: 401 });
  if (!context.env.DB) return Response.json({ error: "D1 binding DB is not configured." }, { status: 503 });

  const body = await context.request.json();
  const title = normalizeRoleTitle(body.title);
  const location = String(body.location || "").trim().slice(0, 120);
  if (!title) return Response.json({ error: "title is required." }, { status: 400 });

  const role = await ensureRole(context.env.DB, title);
  if (location && role.created) {
    await context.env.DB.prepare("UPDATE jobs SET location = ? WHERE id = ?").bind(location, role.id).run();
  }
  return Response.json(
    { id: role.id, title: role.title, title_key: roleTitleKey(role.title), location: location || null, status: "OPEN" },
    { status: role.created ? 201 : 200 }
  );
}
