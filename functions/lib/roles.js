const MAX_ROLE_TITLE_LENGTH = 160;

export function normalizeRoleTitle(value) {
  if (typeof value !== "string") return null;
  if (/[\u0000-\u001f\u007f]/u.test(value)) return null;
  const title = value.normalize("NFKC").trim().replace(/\s+/gu, " ");
  if (!title || title.length > MAX_ROLE_TITLE_LENGTH) return null;
  return title;
}

export function roleTitleKey(value) {
  const title = normalizeRoleTitle(value);
  return title ? title.toLowerCase() : null;
}

export async function ensureRole(db, value) {
  const title = normalizeRoleTitle(value);
  const titleKey = roleTitleKey(title);
  if (!title || !titleKey) throw new TypeError("A valid role title is required.");

  const proposedId = crypto.randomUUID();
  await db.prepare(
    `INSERT OR IGNORE INTO jobs (id, title, title_key, location, status)
     VALUES (?, ?, ?, NULL, 'OPEN')`
  ).bind(proposedId, title, titleKey).run();
  const role = await db.prepare(
    "SELECT id, title FROM jobs WHERE title_key = ? AND status = 'OPEN' ORDER BY created_at ASC LIMIT 1"
  ).bind(titleKey).first();
  if (!role) throw new Error("Role could not be persisted.");
  return { ...role, created: role.id === proposedId };
}
