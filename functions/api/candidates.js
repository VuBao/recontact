import { authorized } from "../lib/auth.js";

export async function onRequestGet(context) {
  if (!(await authorized(context.request, context.env))) return new Response("Unauthorized", { status: 401 });
  if (!context.env.DB) return Response.json({ error: "D1 binding DB is not configured." }, { status: 503 });
  const result = await context.env.DB.prepare(
    "SELECT id, full_name, age, email, phone, current_visa, japanese_level, file_name, created_at FROM candidates ORDER BY created_at DESC"
  ).all();
  return Response.json(result.results);
}
export async function onRequestPost(context) {
  if (!(await authorized(context.request, context.env))) return new Response("Unauthorized", { status: 401 });
  if (!context.env.DB) return Response.json({ error: "D1 binding DB is not configured." }, { status: 503 });
  const body = await context.request.json();
  if (!body.full_name) return Response.json({ error: "full_name is required." }, { status: 400 });
  const id = crypto.randomUUID();
  await context.env.DB.prepare(
    "INSERT INTO candidates (id, full_name, age, email, phone, current_visa, japanese_level, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(id, body.full_name, body.age || null, body.email || null, body.phone || null, body.current_visa || null, body.japanese_level || null, body.source || "manual").run();
  return Response.json({ id }, { status: 201 });
}

export async function onRequestDelete(context) {
  if (!(await authorized(context.request, context.env))) return new Response("Unauthorized", { status: 401 });
  if (!context.env.DB) return Response.json({ error: "D1 binding DB is not configured." }, { status: 503 });
  const body = await context.request.json().catch(() => ({}));
  const ids = [...new Set((Array.isArray(body.ids) ? body.ids : []).filter(id => typeof id === "string" && id.trim()).map(id => id.trim()))];
  if (!ids.length) return Response.json({ error: "Select at least one candidate." }, { status: 400 });
  if (ids.length > 100) return Response.json({ error: "You can delete at most 100 candidates at once." }, { status: 400 });

  const placeholders = ids.map(() => "?").join(",");
  const selected = await context.env.DB.prepare(
    `SELECT id, file_key FROM candidates WHERE id IN (${placeholders})`
  ).bind(...ids).all();
  const rows = selected.results || [];
  if (!rows.length) return Response.json({ deleted: 0 });

  const fileKeys = rows.map(row => row.file_key).filter(Boolean);
  if (fileKeys.length && !context.env.CV_BUCKET) return Response.json({ error: "R2 binding CV_BUCKET is not configured." }, { status: 503 });
  const foundIds = rows.map(row => row.id);
  const foundPlaceholders = foundIds.map(() => "?").join(",");
  await context.env.DB.batch([
    context.env.DB.prepare(`DELETE FROM job_candidates WHERE candidate_id IN (${foundPlaceholders})`).bind(...foundIds),
    context.env.DB.prepare(`DELETE FROM candidates WHERE id IN (${foundPlaceholders})`).bind(...foundIds)
  ]);

  if (fileKeys.length && context.env.CV_BUCKET) await Promise.all(fileKeys.map(key => context.env.CV_BUCKET.delete(key)));
  return Response.json({ deleted: foundIds.length });
}
