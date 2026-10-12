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
