import { authorized } from "../../lib/auth.js";
import { createGmailReader } from "../../lib/mail/gmail.js";
import { parseCandidateResponse } from "../../lib/mail/response-parser.js";

function clean(value, max = 500) {
  return String(value ?? "").trim().slice(0, max) || null;
}

function cleanNote(value) {
  const note = String(value ?? "").trim();
  return note.length <= 100 ? note || null : undefined;
}

function senderEmail(value) {
  const match = String(value || "").match(/<([^>]+)>/) || String(value || "").match(/([\w.+-]+@[\w.-]+)/);
  return match?.[1]?.trim().toLowerCase() || "";
}

function validStatus(value) {
  return ["PENDING", "CONFIRMED", "COMPLETED"].includes(value);
}

export async function onRequestGet(context) {
  if (!(await authorized(context.request, context.env))) return new Response("Unauthorized", { status: 401 });
  if (!context.env.DB) return Response.json({ error: "D1 binding DB is not configured." }, { status: 503 });
  const result = await context.env.DB.prepare(
    `SELECT id, full_name, email, file_name, response_status, response_name, response_phone,
            response_availability, response_start_date, response_note, response_received_at, response_confirmed_at
       FROM candidates WHERE response_status IS NOT NULL ORDER BY response_received_at DESC, updated_at DESC`
  ).all();
  return Response.json(result.results || []);
}

export async function onRequestPost(context) {
  if (!(await authorized(context.request, context.env))) return new Response("Unauthorized", { status: 401 });
  if (!context.env.DB) return Response.json({ error: "D1 binding DB is not configured." }, { status: 503 });
  const reader = createGmailReader(context.env);
  if (!reader) return Response.json({ synced: 0, skipped: true });
  try {
    const candidates = (await context.env.DB.prepare("SELECT id, email FROM candidates WHERE email IS NOT NULL").all()).results || [];
    const byEmail = new Map(candidates.map(item => [String(item.email).trim().toLowerCase(), item]));
    const newest = new Map();
    for (const message of await reader.recentMessages()) {
      const candidate = byEmail.get(senderEmail(message.from));
      const parsed = parseCandidateResponse(message.text);
      if (!candidate || !parsed) continue;
      const previous = newest.get(candidate.id);
      if (!previous || message.receivedAt > previous.receivedAt) newest.set(candidate.id, { candidate, parsed, ...message });
    }
    let synced = 0;
    for (const item of newest.values()) {
      await context.env.DB.prepare(
        `UPDATE candidates SET response_status = 'PENDING', response_name = ?, response_phone = ?,
                response_availability = ?, response_start_date = ?, response_received_at = ?,
                response_message_id = ?, response_note = NULL, updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND (response_message_id IS NULL OR response_message_id <> ?)`
      ).bind(item.parsed.name, item.parsed.phone, item.parsed.availability, item.parsed.startDate, item.receivedAt, item.id, item.candidate.id, item.id).run();
      synced++;
    }
    return Response.json({ synced });
  } catch {
    return Response.json({ error: "Không thể đồng bộ phản hồi Gmail." }, { status: 503 });
  }
}

export async function onRequestPatch(context) {
  if (!(await authorized(context.request, context.env))) return new Response("Unauthorized", { status: 401 });
  if (!context.env.DB) return Response.json({ error: "D1 binding DB is not configured." }, { status: 503 });
  const body = await context.request.json().catch(() => ({}));
  const id = clean(body.candidate_id, 100);
  const status = clean(body.status, 20);
  const hasNote = Object.prototype.hasOwnProperty.call(body, "note");
  const note = hasNote ? cleanNote(body.note) : null;
  if (!id || !validStatus(status)) return Response.json({ error: "candidate_id and a valid status are required." }, { status: 400 });
  if (note === undefined) return Response.json({ error: "note must be at most 100 characters." }, { status: 400 });
  const confirmedAt = status === "PENDING" ? null : new Date().toISOString();
  const result = await context.env.DB.prepare(
    `UPDATE candidates SET response_name = ?, response_phone = ?, response_availability = ?,
            response_start_date = ?, response_status = ?, response_note = CASE WHEN ? THEN ? ELSE response_note END,
            response_confirmed_at = COALESCE(?, response_confirmed_at),
            updated_at = CURRENT_TIMESTAMP WHERE id = ? AND response_status IS NOT NULL`
  ).bind(clean(body.name), clean(body.phone), clean(body.availability), clean(body.start_date), status, hasNote ? 1 : 0, note, confirmedAt, id).run();
  if (!result.meta?.changes) return Response.json({ error: "Candidate response not found." }, { status: 404 });
  return Response.json({ updated: true, candidate_id: id, status });
}
