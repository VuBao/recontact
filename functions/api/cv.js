import { authorized } from "../lib/auth.js";

export async function onRequestGet(context) {
  if (!(await authorized(context.request, context.env))) return new Response("Unauthorized", { status: 401 });
  if (!context.env.DB || !context.env.CV_BUCKET) return Response.json({ error: "Storage bindings are not ready." }, { status: 503 });

  const id = new URL(context.request.url).searchParams.get("id");
  if (!id) return Response.json({ error: "id is required." }, { status: 400 });
  const candidate = await context.env.DB.prepare(
    "SELECT file_key, file_name FROM candidates WHERE id = ?"
  ).bind(id).first();
  if (!candidate?.file_key) return Response.json({ error: "CV not found." }, { status: 404 });

  const object = await context.env.CV_BUCKET.get(candidate.file_key);
  if (!object) return Response.json({ error: "CV file not found." }, { status: 404 });
  const name = String(candidate.file_name || "cv.pdf").replace(/[\r\n"]/g, "_");
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Content-Type", "application/pdf");
  headers.set("Content-Disposition", `inline; filename="${name}"`);
  headers.set("Cache-Control", "private, no-store");
  return new Response(object.body, { headers });
}
