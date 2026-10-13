import { authorized } from "../lib/auth.js";
import { resolveRecipients } from "../lib/mail/recipients.js";

export async function onRequestPost(context) {
  if (!(await authorized(context.request, context.env))) {
    return new Response("Unauthorized", { status: 401 });
  }
  if (!context.env.DB) {
    return Response.json({ error: "D1 binding DB is not configured." }, { status: 503 });
  }

  let body;
  try {
    body = await context.request.json();
  } catch {
    return Response.json({ error: "Malformed JSON body." }, { status: 400 });
  }

  try {
    const result = await resolveRecipients(
      context.env.DB,
      body.candidate_ids,
      body.company_name,
      body.job_paragraph ?? null
    );
    return Response.json(result);
  } catch (err) {
    const status = err.status || 400;
    return Response.json({ error: err.message, error_code: err.code || "INVALID_REQUEST" }, { status });
  }
}
