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

  const companyName = String(body.company_name || "").trim();
  if (!companyName) {
    return Response.json({ error: "company_name is required." }, { status: 400 });
  }

  if (!Array.isArray(body.candidate_ids) || !body.candidate_ids.length) {
    return Response.json({ error: "candidate_ids must be a non-empty array." }, { status: 400 });
  }

  try {
    const { ready, unresolvable } = await resolveRecipients(
      context.env.DB,
      body.candidate_ids,
      companyName
    );

    return Response.json({
      company_name: companyName,
      total: body.candidate_ids.length,
      ready_count: ready.length,
      unresolvable_count: unresolvable.length,
      ready,
      unresolvable
    });
  } catch (err) {
    const status = err.status || 400;
    return Response.json({ error: err.message }, { status });
  }
}
