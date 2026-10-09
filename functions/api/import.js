function authorized(request, env) {
  return Boolean(env.ADMIN_TOKEN) && request.headers.get("Authorization") === `Bearer ${env.ADMIN_TOKEN}`;
}
function safeFileName(name) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120);
}
async function sha256(buffer) {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
export async function onRequestPost(context) {
  if (!authorized(context.request, context.env)) return new Response("Unauthorized", { status: 401 });
  if (!context.env.DB || !context.env.CV_BUCKET) return Response.json({ error: "Storage bindings are not ready." }, { status: 503 });
  const form = await context.request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ error: "A file is required." }, { status: 400 });
  if (!/\.(pdf|doc|docx)$/i.test(file.name)) return Response.json({ error: "Only PDF, DOC, and DOCX files are accepted." }, { status: 400 });
  if (file.size > 15 * 1024 * 1024) return Response.json({ error: "Each file must be 15 MB or smaller." }, { status: 413 });
  const body = await file.arrayBuffer();
  const fileHash = await sha256(body);
  const duplicate = await context.env.DB.prepare("SELECT id, file_name FROM candidates WHERE file_hash = ?").bind(fileHash).first();
  if (duplicate) return Response.json({ duplicate: true, candidate: duplicate });
  const id = crypto.randomUUID();
  const fileKey = `cv/${id}/${safeFileName(file.name)}`;
  const fullName = String(form.get("full_name") || file.name.replace(/\.[^.]+$/, "")).slice(0, 160);
  const labels = String(form.get("labels") || "").split(",").map((label) => label.trim()).filter(Boolean).slice(0, 12);
  await context.env.CV_BUCKET.put(fileKey, body, { httpMetadata: { contentType: file.type || "application/octet-stream" } });
  try {
    await context.env.DB.prepare(
      "INSERT INTO candidates (id, full_name, labels_json, source, file_key, file_name, file_hash) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).bind(id, fullName, JSON.stringify(labels), "folder_import", fileKey, file.name, fileHash).run();
  } catch (error) {
    await context.env.CV_BUCKET.delete(fileKey);
    throw error;
  }
  return Response.json({ id, file_name: file.name, labels }, { status: 201 });
}