import { authorized } from "../lib/auth.js";
import { resolveRecipients } from "../lib/mail/recipients.js";
import { validateAttachments } from "../lib/mail/attachments.js";
import {
  createBatch,
  getBatchByIdempotencyKey,
  getBatchDeliveries,
  insertDeliveries,
  updateDelivery,
  finalizeBatch
} from "../lib/mail/batches.js";
import { sendEmail } from "../lib/mail/provider.js";

const CONCURRENCY_LIMIT = 3;

function sanitizeError(err) {
  if (!err) return "Unknown delivery error.";
  const raw = String(err.message || err || "")
    .replace(/bearer\s+[a-z0-9._-]+/gi, "bearer [REDACTED]")
    .replace(/api[_-]?key[:=]\s*[^\s]+/gi, "api_key=[REDACTED]");

  if (err.status === 429 || raw.includes("429") || /rate limit/i.test(raw)) {
    return "Provider rate limit exceeded.";
  }
  if (err.status >= 500 || /server error|service unavailable/i.test(raw)) {
    return "Temporary mail provider service error.";
  }
  return raw.slice(0, 200);
}

function isRetryable(err) {
  if (!err) return false;
  if (err.status === 429 || (err.status >= 500 && err.status < 600)) return true;
  const code = err.code || "";
  if (code === "ECONNRESET" || code === "ETIMEDOUT" || code === "EAI_AGAIN") return true;
  return false;
}

async function sendWithRetry(env, payload, maxRetries = 2) {
  let attempt = 0;
  while (true) {
    try {
      return await sendEmail(env, payload);
    } catch (err) {
      attempt++;
      if (!isRetryable(err) || attempt > maxRetries) {
        throw err;
      }
      // Exponential / fixed small backoff
      await new Promise(res => setTimeout(res, attempt * 50));
    }
  }
}

async function mapConcurrent(items, limit, fn) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const idx = nextIndex++;
      results[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function onRequestPost(context) {
  if (!(await authorized(context.request, context.env))) {
    return new Response("Unauthorized", { status: 401 });
  }
  if (!context.env.DB) {
    return Response.json({ error: "D1 binding DB is not configured." }, { status: 503 });
  }

  let formData;
  try {
    formData = await context.request.formData();
  } catch {
    return Response.json({ error: "Multipart form data is required." }, { status: 400 });
  }

  const idempotencyKey = String(formData.get("idempotency_key") || "").trim();
  if (!idempotencyKey) {
    return Response.json({ error: "idempotency_key is required." }, { status: 400 });
  }

  const companyName = String(formData.get("company_name") || "").trim();
  if (!companyName) {
    return Response.json({ error: "company_name is required." }, { status: 400 });
  }

  // Parse candidate_ids
  let candidateIds = [];
  const candidateIdsRaw = formData.get("candidate_ids");
  if (typeof candidateIdsRaw === "string" && candidateIdsRaw.startsWith("[")) {
    try {
      candidateIds = JSON.parse(candidateIdsRaw);
    } catch {
      return Response.json({ error: "candidate_ids must be a valid JSON array." }, { status: 400 });
    }
  } else {
    candidateIds = formData.getAll("candidate_ids").filter(Boolean);
  }

  if (!Array.isArray(candidateIds) || !candidateIds.length) {
    return Response.json({ error: "candidate_ids must be a non-empty array." }, { status: 400 });
  }

  // Validate attachments
  let attachments = [];
  try {
    const rawFiles = formData.getAll("attachments").filter(item => item instanceof File && item.size > 0);
    attachments = await validateAttachments(rawFiles);
  } catch (err) {
    return Response.json({ error: err.message }, { status: 400 });
  }

  // Idempotency check
  const existingBatch = await getBatchByIdempotencyKey(context.env.DB, idempotencyKey);
  if (existingBatch) {
    // If different payload: conflict
    if (
      existingBatch.company_name !== companyName ||
      existingBatch.total_count !== candidateIds.length
    ) {
      return Response.json(
        { error: "Conflicting payload with existing idempotency key." },
        { status: 409 }
      );
    }

    if (existingBatch.status === "PROCESSING") {
      return Response.json({ error: "Batch is currently processing." }, { status: 409 });
    }

    // Return stored results immediately
    const deliveries = await getBatchDeliveries(context.env.DB, existingBatch.id);
    const statusCode = existingBatch.failed_count > 0 ? 207 : 200;
    return Response.json(
      {
        batch_id: existingBatch.id,
        idempotency_key: existingBatch.idempotency_key,
        status: existingBatch.status,
        total: existingBatch.total_count,
        sent: existingBatch.sent_count,
        failed: existingBatch.failed_count,
        deliveries: deliveries.map(d => ({
          candidate_id: d.candidate_id,
          recipient_email: d.recipient_email,
          status: d.status,
          error: d.error_message || undefined
        }))
      },
      { status: statusCode }
    );
  }

  // Authoritatively re-resolve candidates from D1
  let resolved;
  try {
    resolved = await resolveRecipients(context.env.DB, candidateIds, companyName);
  } catch (err) {
    const status = err.status || 400;
    return Response.json({ error: err.message }, { status });
  }

  const { ready, unresolvable } = resolved;
  const batchId = crypto.randomUUID();

  // Create audit batch row
  await createBatch(context.env.DB, {
    id: batchId,
    idempotencyKey,
    companyName,
    totalCount: candidateIds.length
  });

  // Prepare deliveries
  const deliveryItems = [];
  for (const c of ready) {
    deliveryItems.push({
      id: crypto.randomUUID(),
      candidate_id: c.candidate_id,
      recipient_email: c.email,
      recipient_name: c.name,
      _candidate: c
    });
  }
  for (const u of unresolvable) {
    deliveryItems.push({
      id: crypto.randomUUID(),
      candidate_id: u.candidate_id,
      recipient_email: "",
      recipient_name: u.name || "Unknown",
      _unresolvableReason: u.reason
    });
  }

  await insertDeliveries(
    context.env.DB,
    batchId,
    deliveryItems.map(({ id, candidate_id, recipient_email, recipient_name }) => ({
      id,
      candidate_id,
      recipient_email,
      recipient_name
    }))
  );

  // Send orchestration with bounded concurrency = 3
  const outcomes = await mapConcurrent(deliveryItems, CONCURRENCY_LIMIT, async item => {
    if (item._unresolvableReason) {
      const safeErr = `Candidate email could not be resolved (${item._unresolvableReason}).`;
      await updateDelivery(context.env.DB, item.id, {
        status: "FAILED",
        errorMessage: safeErr
      });
      return {
        candidate_id: item.candidate_id,
        status: "FAILED",
        error: safeErr
      };
    }

    try {
      const res = await sendWithRetry(context.env, {
        to: item.recipient_email,
        toName: item.recipient_name,
        subject: item._candidate.subject,
        text: item._candidate.text,
        html: item._candidate.html,
        attachments
      });

      await updateDelivery(context.env.DB, item.id, {
        status: "SENT",
        sentAt: new Date().toISOString(),
        providerMessageId: res?.id || `msg-${Date.now()}`
      });

      return {
        candidate_id: item.candidate_id,
        recipient_email: item.recipient_email,
        status: "SENT"
      };
    } catch (err) {
      const safeErr = sanitizeError(err);
      await updateDelivery(context.env.DB, item.id, {
        status: "FAILED",
        errorMessage: safeErr
      });

      return {
        candidate_id: item.candidate_id,
        recipient_email: item.recipient_email,
        status: "FAILED",
        error: safeErr
      };
    }
  });

  const sentCount = outcomes.filter(o => o.status === "SENT").length;
  const failedCount = outcomes.filter(o => o.status === "FAILED").length;
  const batchStatus = failedCount === 0 ? "COMPLETED" : sentCount === 0 ? "FAILED" : "PARTIAL_FAILURE";

  await finalizeBatch(context.env.DB, batchId, {
    status: batchStatus,
    sentCount,
    failedCount
  });

  const statusCode = failedCount > 0 ? 207 : 200;
  return Response.json(
    {
      batch_id: batchId,
      idempotency_key: idempotencyKey,
      status: batchStatus,
      total: candidateIds.length,
      sent: sentCount,
      failed: failedCount,
      deliveries: outcomes
    },
    { status: statusCode }
  );
}
