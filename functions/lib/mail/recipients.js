import { renderCandidateEmail } from "./template.js";

export const MAX_RECIPIENTS = 20;

function requestError(message, code = "INVALID_REQUEST") {
  const error = new Error(message);
  error.status = 400;
  error.code = code;
  return error;
}

export function isValidEmail(email) {
  if (!email || typeof email !== "string") return false;
  const trimmed = email.trim();
  if (trimmed.length > 254) return false;
  return /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/.test(trimmed);
}

export async function resolveRecipients(db, candidateIds, companyName, jobParagraph = null) {
  if (!Array.isArray(candidateIds) || candidateIds.length === 0) {
    throw requestError("candidate_ids must be a non-empty array.");
  }

  const orderedIds = [...new Set(candidateIds.map(id => String(id ?? "").trim()).filter(Boolean))];
  if (!orderedIds.length) throw requestError("No valid candidate IDs provided.");
  if (orderedIds.length > MAX_RECIPIENTS) {
    throw requestError(`Each batch is limited to ${MAX_RECIPIENTS} candidates.`, "BATCH_LIMIT_EXCEEDED");
  }
  if (typeof companyName !== "string" || !companyName.trim()) {
    throw requestError("company_name is required.", "COMPANY_MISSING");
  }

  const placeholders = orderedIds.map(() => "?").join(",");
  const result = await db.prepare(`
    SELECT
      c.id,
      c.full_name,
      c.email,
      j.id AS role_id,
      j.title AS role_title
    FROM candidates c
    LEFT JOIN job_candidates jc ON jc.candidate_id = c.id
    LEFT JOIN jobs j ON j.id = jc.job_id AND j.status = 'OPEN'
    WHERE c.id IN (${placeholders})
    ORDER BY c.id, j.created_at, j.id
  `).bind(...orderedIds).all();

  const grouped = new Map();
  for (const row of result.results ?? []) {
    let candidate = grouped.get(row.id);
    if (!candidate) {
      candidate = {
        id: row.id,
        full_name: row.full_name,
        email: row.email,
        roles: new Map()
      };
      grouped.set(row.id, candidate);
    }
    if (row.role_id && row.role_title) candidate.roles.set(row.role_id, row.role_title);
  }

  const missingIds = orderedIds.filter(id => !grouped.has(id));
  if (missingIds.length) throw requestError(`Unknown candidate IDs: ${missingIds.join(", ")}`);

  const items = orderedIds.map(candidateId => {
    const candidate = grouped.get(candidateId);
    const candidateName = String(candidate.full_name ?? "").trim();
    const email = String(candidate.email ?? "").trim();
    const roleTitles = [...candidate.roles.values()];
    const base = {
      candidate_id: candidateId,
      candidate_name: candidateName,
      email,
      role_title: roleTitles.length === 1 ? roleTitles[0] : null,
      subject: null,
      body_text: null,
      status: "BLOCKED",
      error_code: null
    };

    if (!email) return { ...base, error_code: "EMAIL_MISSING" };
    if (!isValidEmail(email)) return { ...base, error_code: "EMAIL_INVALID" };
    if (roleTitles.length === 0) return { ...base, error_code: "ROLE_MISSING" };
    if (roleTitles.length > 1) return { ...base, error_code: "ROLE_AMBIGUOUS" };

    const rendered = renderCandidateEmail({
      candidateName,
      companyName: companyName.trim(),
      roleTitle: roleTitles[0],
      jobParagraph
    });
    return {
      ...base,
      role_title: roleTitles[0],
      subject: rendered.subject,
      body_text: rendered.bodyText,
      status: "READY"
    };
  });

  return {
    items,
    eligible: items.filter(item => item.status === "READY").length,
    blocked: items.filter(item => item.status !== "READY").length
  };
}
