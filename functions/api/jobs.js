function authorized(request, env) {
  return Boolean(env.ADMIN_TOKEN) && request.headers.get("Authorization") === `Bearer ${env.ADMIN_TOKEN}`;
}

export async function onRequestGet(context) {
  if (!authorized(context.request, context.env)) return new Response("Unauthorized", { status: 401 });
  if (!context.env.DB) return Response.json({ error: "D1 binding DB is not configured." }, { status: 503 });

  const result = await context.env.DB.prepare(
    "SELECT id, title, location, status, created_at FROM jobs ORDER BY created_at DESC"
  ).all();
  return Response.json(result.results);
}

export async function onRequestPost(context) {
  if (!authorized(context.request, context.env)) return new Response("Unauthorized", { status: 401 });
  if (!context.env.DB) return Response.json({ error: "D1 binding DB is not configured." }, { status: 503 });

  const body = await context.request.json();
  const title = String(body.title || "").trim().slice(0, 160);
  const location = String(body.location || "").trim().slice(0, 120);
  if (!title) return Response.json({ error: "title is required." }, { status: 400 });

  const id = crypto.randomUUID();
  await context.env.DB.prepare(
    "INSERT INTO jobs (id, title, location, status) VALUES (?, ?, ?, 'OPEN')"
  ).bind(id, title, location || null).run();

  return Response.json({ id, title, location: location || null, status: "OPEN" }, { status: 201 });
}
