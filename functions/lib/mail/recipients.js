import { renderCandidateEmail } from "./templates.js";

export const MAX_RECIPIENTS = 100;

export function isValidEmail(email) {
  if (!email || typeof email !== "string") return false;
  const trimmed = email.trim();
  if (trimmed.length > 254) return false;
  return /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/.test(trimmed);
}

export async function resolveRecipients(db, candidateIds, companyName) {
  if (!Array.isArray(candidateIds) || candidateIds.length === 0) {
    throw new Error("candidate_ids must be a non-empty array.");
  }
  if (candidateIds.length > MAX_RECIPIENTS) {
    throw new Error(`Exceeded maximum limit of ${MAX_RECIPIENTS} candidates per batch.`);
  }
  if (!companyName || typeof companyName !== "string" || !companyName.trim()) {
    throw new Error("company_name is required.");
  }

  // Deduplicate preserving order
  const orderedIds = [...new Set(candidateIds.map(id => String(id || "").trim()).filter(Boolean))];
  if (!orderedIds.length) {
    throw new Error("No valid candidate IDs provided.");
  }

  const placeholders = orderedIds.map(() => "?").join(",");
  const query = `
    SELECT id, full_name, age, email, phone, current_visa, japanese_level, labels_json
    FROM candidates
    WHERE id IN (${placeholders})
  `;
  const result = await db.prepare(query).bind(...orderedIds).all();
  const rows = result.results || [];
  const candidateMap = new Map(rows.map(row => [row.id, row]));

  // Verify all IDs exist in D1
  const missingIds = orderedIds.filter(id => !candidateMap.has(id));
  if (missingIds.length > 0) {
    const error = new Error(`Unknown candidate IDs: ${missingIds.join(", ")}`);
    error.status = 400;
    throw error;
  }

  const ready = [];
  const unresolvable = [];

  for (const id of orderedIds) {
    const candidate = candidateMap.get(id);
    const email = (candidate.email || "").trim();

    if (!email) {
      unresolvable.push({
        candidate_id: id,
        name: candidate.full_name,
        reason: "missing_email"
      });
      continue;
    }

    if (!isValidEmail(email)) {
      unresolvable.push({
        candidate_id: id,
        name: candidate.full_name,
        reason: "invalid_email"
      });
      continue;
    }

    const rendered = renderCandidateEmail({ candidate, companyName });
    ready.push({
      candidate_id: id,
      name: candidate.full_name,
      email,
      role: rendered.role,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html
    });
  }

  return { ready, unresolvable };
}
