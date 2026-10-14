import { authorized } from "../../../lib/auth.js";

function clean(value, max = 500) {
  return String(value ?? "").trim().slice(0, max) || null;
}

function cleanNote(value) {
  const note = String(value ?? "").trim();
  return note.length <= 100 ? note || null : undefined;
}

// <candidate-response-manual-create>
export async function onRequestPost(context) {
  if (!(await authorized(context.request, context.env))) return new Response("Unauthorized", { status: 401 });
  if (!context.env.DB) return Response.json({ error: "D1 binding DB is not configured." }, { status: 503 });

  const body = await context.request.json().catch(() => ({}));
  const id = clean(body.candidate_id, 100);
  const note = cleanNote(body.note);
  if (!id) return Response.json({ error: "candidate_id is required." }, { status: 400 });
  if (note === undefined) return Response.json({ error: "note must be at most 100 characters." }, { status: 400 });

  const found = await context.env.DB.prepare("SELECT id FROM candidates WHERE id = ? LIMIT 1").bind(id).all();
  if (!(found.results || []).length) return Response.json({ error: "Candidate not found." }, { status: 404 });

  const now = new Date().toISOString();
  await context.env.DB.prepare(
    `UPDATE candidates SET response_name = ?, response_phone = ?, response_availability = ?,
            response_start_date = ?, response_note = ?, response_status = 'CONFIRMED',
            response_received_at = ?, response_confirmed_at = ?, response_message_id = NULL,
            updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).bind(clean(body.name), clean(body.phone), clean(body.availability), clean(body.start_date), note, now, now, id).run();

  return Response.json({ created: true, candidate_id: id, status: "CONFIRMED" });
}
// </candidate-response-manual-create>
