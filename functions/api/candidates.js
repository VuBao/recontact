function authorized(request, env) {
  const header = request.headers.get("Authorization");
  return Boolean(env.ADMIN_TOKEN) && header === `Bearer ${env.ADMIN_TOKEN}`;
}
export async function onRequestGet(context) {
  if (!authorized(context.request, context.env)) return new Response("Unauthorized", { status: 401 });
  if (!context.env.DB) return Response.json({ error: "D1 binding DB is not configured." }, { status: 503 });
  const result = await context.env.DB.prepare(
    "SELECT id, full_name, email, phone, japanese_level, status, labels_json, source, file_name, created_at FROM candidates ORDER BY created_at DESC"
  ).all();
  return Response.json(result.results.map((row) => ({ ...row, labels: JSON.parse(row.labels_json || "[]") })));
}
export async function onRequestPost(context) {
  if (!authorized(context.request, context.env)) return new Response("Unauthorized", { status: 401 });
  if (!context.env.DB) return Response.json({ error: "D1 binding DB is not configured." }, { status: 503 });
  const body = await context.request.json();
  if (!body.full_name) return Response.json({ error: "full_name is required." }, { status: 400 });
  const id = crypto.randomUUID();
  const labels = Array.isArray(body.labels) ? body.labels : [];
  await context.env.DB.prepare(
    "INSERT INTO candidates (id, full_name, email, phone, japanese_level, labels_json, source) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).bind(id, body.full_name, body.email || null, body.phone || null, body.japanese_level || null, JSON.stringify(labels), body.source || "manual").run();
  return Response.json({ id }, { status: 201 });
}