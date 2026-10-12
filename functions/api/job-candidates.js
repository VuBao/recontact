function authorized(request, env) {
  return Boolean(env.ADMIN_TOKEN) && request.headers.get("Authorization") === `Bearer ${env.ADMIN_TOKEN}`;
}

const statuses = ["SELECTED", "SENT", "INTERESTED", "BOOKED"];
const timestampColumns = {
  SENT: "invited_at",
  INTERESTED: "responded_at",
  BOOKED: "booked_at"
};

export async function onRequestGet(context) {
  if (!authorized(context.request, context.env)) return new Response("Unauthorized", { status: 401 });
  if (!context.env.DB) return Response.json({ error: "D1 binding DB is not configured." }, { status: 503 });

  const jobId = new URL(context.request.url).searchParams.get("job_id");
  if (!jobId) return Response.json({ error: "job_id is required." }, { status: 400 });

  const result = await context.env.DB.prepare(
    `SELECT jc.id, jc.job_id, jc.candidate_id, jc.status, jc.invited_at, jc.responded_at, jc.booked_at,
            c.full_name, c.email, c.phone, c.japanese_level, c.labels_json, c.file_name
       FROM job_candidates jc
       JOIN candidates c ON c.id = jc.candidate_id
      WHERE jc.job_id = ?
      ORDER BY jc.created_at DESC`
  ).bind(jobId).all();

  return Response.json(result.results.map((row) => {
    const { labels_json: labelsJson, ...assignment } = row;
    return { ...assignment, labels: JSON.parse(labelsJson || "[]") };
  }));
}

export async function onRequestPost(context) {
  if (!authorized(context.request, context.env)) return new Response("Unauthorized", { status: 401 });
  if (!context.env.DB) return Response.json({ error: "D1 binding DB is not configured." }, { status: 503 });

  const body = await context.request.json();
  const jobId = String(body.job_id || "");
  const candidateId = String(body.candidate_id || "");
  if (!jobId || !candidateId) return Response.json({ error: "job_id and candidate_id are required." }, { status: 400 });

  const [job, candidate] = await Promise.all([
    context.env.DB.prepare("SELECT id FROM jobs WHERE id = ?").bind(jobId).first(),
    context.env.DB.prepare("SELECT id FROM candidates WHERE id = ?").bind(candidateId).first()
  ]);
  if (!job) return Response.json({ error: "Job not found." }, { status: 404 });
  if (!candidate) return Response.json({ error: "Candidate not found." }, { status: 404 });

  const id = crypto.randomUUID();
  await context.env.DB.prepare(
    "INSERT OR IGNORE INTO job_candidates (id, job_id, candidate_id, status) VALUES (?, ?, ?, 'SELECTED')"
  ).bind(id, jobId, candidateId).run();

  const assignment = await context.env.DB.prepare(
    "SELECT id, job_id, candidate_id, status FROM job_candidates WHERE job_id = ? AND candidate_id = ?"
  ).bind(jobId, candidateId).first();
  return Response.json(assignment, { status: assignment.id === id ? 201 : 200 });
}

export async function onRequestPatch(context) {
  if (!authorized(context.request, context.env)) return new Response("Unauthorized", { status: 401 });
  if (!context.env.DB) return Response.json({ error: "D1 binding DB is not configured." }, { status: 503 });

  const body = await context.request.json();
  const id = String(body.id || "");
  const status = String(body.status || "").toUpperCase();
  if (!id || !statuses.includes(status)) return Response.json({ error: "A valid id and status are required." }, { status: 400 });

  const current = await context.env.DB.prepare(
    "SELECT id, status FROM job_candidates WHERE id = ?"
  ).bind(id).first();
  if (!current) return Response.json({ error: "Assignment not found." }, { status: 404 });

  const currentIndex = statuses.indexOf(current.status);
  const nextIndex = statuses.indexOf(status);
  if (nextIndex !== currentIndex + 1) {
    return Response.json({ error: `Invalid transition from ${current.status} to ${status}.` }, { status: 409 });
  }

  const timestampColumn = timestampColumns[status];
  const sql = timestampColumn
    ? `UPDATE job_candidates SET status = ?, ${timestampColumn} = COALESCE(${timestampColumn}, CURRENT_TIMESTAMP) WHERE id = ?`
    : "UPDATE job_candidates SET status = ? WHERE id = ?";
  await context.env.DB.prepare(sql).bind(status, id).run();

  return Response.json({ id, status });
}
