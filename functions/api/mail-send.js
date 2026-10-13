import { authorized } from "../lib/auth.js";
import { validateAttachments } from "../lib/mail/attachments.js";
import {
  createBatch,
  finalizeBatch,
  getBatchByIdempotencyKey,
  getBatchDeliveries,
  insertDeliveries,
  updateDelivery
} from "../lib/mail/batches.js";
import { MailProviderError } from "../lib/mail/errors.js";
import { createMailProvider } from "../lib/mail/provider.js";
import { resolveRecipients } from "../lib/mail/recipients.js";

const CONCURRENCY_LIMIT = 3;
const MAX_RETRIES = 2;

function jsonError(message, status, errorCode = "INVALID_REQUEST", extra = {}) {
  return Response.json({ error: message, error_code: errorCode, ...extra }, { status });
}

function safeDeliveryError(error) {
  if (error instanceof MailProviderError) {
    return { code: error.code, message: error.message };
  }
  return { code: "UNKNOWN_SEND_ERROR", message: "Mail delivery failed." };
}

function isRetryable(error) {
  const status = Number(error?.httpStatus ?? error?.status);
  return status === 429 || (status >= 500 && status < 600);
}

async function sendWithRetry(provider, message) {
  let attempt = 0;
  while (true) {
    try {
      return await provider.send(message);
    } catch (error) {
      if (!isRetryable(error) || attempt >= MAX_RETRIES) throw error;
      attempt += 1;
      await new Promise(resolve => setTimeout(resolve, attempt * 50));
    }
  }
}

async function mapConcurrent(items, limit, fn) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

function bytesToHex(bytes) {
  return [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, "0")).join("");
}

async function sha256(value) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  return bytesToHex(await crypto.subtle.digest("SHA-256", bytes));
}

async function requestFingerprint(payload, attachments) {
  const attachmentDescriptors = [];
  for (const attachment of attachments) {
    attachmentDescriptors.push({
      filename: attachment.filename,
      content_type: attachment.contentType,
      size: attachment.bytes.byteLength,
      sha256: await sha256(attachment.bytes)
    });
  }
  return sha256(JSON.stringify({
    candidate_ids: [...new Set(payload.candidate_ids.map(id => String(id ?? "").trim()).filter(Boolean))],
    company_name: String(payload.company_name ?? "").trim(),
    job_paragraph: payload.job_paragraph == null ? null : String(payload.job_paragraph).trim(),
    attachments: attachmentDescriptors
  }));
}

function storedResponse(batch, deliveries) {
  return {
    batch_id: batch.id,
    status: batch.status,
    sent: batch.sent_count,
    failed: batch.failed_count,
    results: deliveries.map(delivery => ({
      candidate_id: delivery.candidate_id,
      status: delivery.status,
      provider_message_id: delivery.provider_message_id || null,
      error_code: delivery.error_code || null,
      error_message: delivery.error_message || null
    }))
  };
}

export async function onRequestPost(context) {
  if (!(await authorized(context.request, context.env))) {
    return new Response("Unauthorized", { status: 401 });
  }
  if (!context.env.DB) return jsonError("D1 binding DB is not configured.", 503, "DB_NOT_CONFIGURED");

  let formData;
  try {
    formData = await context.request.formData();
  } catch {
    return jsonError("Multipart form data is required.", 400);
  }

  let payload;
  try {
    const raw = formData.get("payload");
    if (typeof raw !== "string") throw new Error();
    payload = JSON.parse(raw);
  } catch {
    return jsonError("payload must be valid JSON.", 400);
  }

  const idempotencyKey = String(payload.idempotency_key ?? "").trim();
  if (!idempotencyKey) return jsonError("idempotency_key is required.", 400);
  if (!Array.isArray(payload.candidate_ids) || !payload.candidate_ids.length) {
    return jsonError("candidate_ids must be a non-empty array.", 400);
  }

  let attachments;
  try {
    const files = formData.getAll("attachments").filter(item => item instanceof File && item.size > 0);
    attachments = await validateAttachments(files);
  } catch (error) {
    return jsonError(error.message, 400, "ATTACHMENT_INVALID");
  }

  let fingerprint;
  try {
    fingerprint = await requestFingerprint(payload, attachments);
  } catch {
    return jsonError("Unable to validate the request payload.", 400);
  }

  const existingBatch = await getBatchByIdempotencyKey(context.env.DB, idempotencyKey);
  if (existingBatch) {
    if (existingBatch.request_fingerprint !== fingerprint) {
      return jsonError("Conflicting payload with existing idempotency key.", 409, "IDEMPOTENCY_CONFLICT");
    }
    if (existingBatch.status === "PROCESSING") {
      return jsonError("Batch is currently processing.", 409, "BATCH_IN_PROGRESS");
    }
    const deliveries = await getBatchDeliveries(context.env.DB, existingBatch.id);
    return Response.json(storedResponse(existingBatch, deliveries), {
      status: existingBatch.failed_count > 0 ? 207 : 200
    });
  }

  let resolved;
  try {
    resolved = await resolveRecipients(
      context.env.DB,
      payload.candidate_ids,
      payload.company_name,
      payload.job_paragraph ?? null
    );
  } catch (error) {
    return jsonError(error.message, error.status || 400, error.code || "INVALID_REQUEST");
  }
  if (resolved.blocked > 0) {
    return jsonError(
      "All candidates must have a valid email and exactly one open role before sending.",
      400,
      "RECIPIENTS_BLOCKED",
      { items: resolved.items }
    );
  }

  let provider;
  try {
    provider = context.data?.mailProvider || createMailProvider(context.env);
  } catch (error) {
    const safe = safeDeliveryError(error);
    return jsonError(safe.message, error.httpStatus || 503, safe.code);
  }

  const providerName = String(context.env.MAIL_PROVIDER || "gmail").trim().toLowerCase();
  const batchId = crypto.randomUUID();
  try {
    await createBatch(context.env.DB, {
      id: batchId,
      idempotencyKey,
      requestFingerprint: fingerprint,
      provider: providerName,
      companyName: String(payload.company_name).trim(),
      attachmentNames: attachments.map(attachment => attachment.filename),
      requestedCount: resolved.items.length
    });
  } catch {
    const concurrentBatch = await getBatchByIdempotencyKey(context.env.DB, idempotencyKey);
    if (concurrentBatch?.request_fingerprint === fingerprint) {
      return jsonError("Batch is currently processing.", 409, "BATCH_IN_PROGRESS");
    }
    if (concurrentBatch) {
      return jsonError("Conflicting payload with existing idempotency key.", 409, "IDEMPOTENCY_CONFLICT");
    }
    return jsonError("Unable to create the mail batch.", 500, "BATCH_CREATE_FAILED");
  }

  const deliveries = resolved.items.map(item => ({
    id: crypto.randomUUID(),
    candidate_id: item.candidate_id,
    recipient_email: item.email,
    candidate_name: item.candidate_name,
    role_title: item.role_title,
    subject: item.subject,
    body_text: item.body_text
  }));
  await insertDeliveries(context.env.DB, batchId, deliveries);

  const outcomes = await mapConcurrent(deliveries, CONCURRENCY_LIMIT, async delivery => {
    try {
      const providerResult = await sendWithRetry(provider, {
        from: {
          email: context.env.MAIL_FROM_EMAIL,
          name: context.env.MAIL_FROM_NAME
        },
        to: {
          email: delivery.recipient_email,
          name: delivery.candidate_name
        },
        subject: delivery.subject,
        text: delivery.body_text,
        attachments
      });
      const providerMessageId = providerResult?.messageId || null;
      await updateDelivery(context.env.DB, delivery.id, {
        status: "SENT",
        providerMessageId,
        sentAt: new Date().toISOString()
      });
      return {
        candidate_id: delivery.candidate_id,
        status: "SENT",
        provider_message_id: providerMessageId,
        error_code: null
      };
    } catch (error) {
      const safe = safeDeliveryError(error);
      await updateDelivery(context.env.DB, delivery.id, {
        status: "FAILED",
        errorCode: safe.code,
        errorMessage: safe.message
      });
      return {
        candidate_id: delivery.candidate_id,
        status: "FAILED",
        provider_message_id: null,
        error_code: safe.code,
        error_message: safe.message
      };
    }
  });

  const sentCount = outcomes.filter(outcome => outcome.status === "SENT").length;
  const failedCount = outcomes.length - sentCount;
  const status = failedCount === 0 ? "COMPLETED" : sentCount === 0 ? "FAILED" : "PARTIAL_FAILURE";
  await finalizeBatch(context.env.DB, batchId, { status, sentCount, failedCount });

  return Response.json({
    batch_id: batchId,
    status,
    sent: sentCount,
    failed: failedCount,
    results: outcomes
  }, { status: failedCount > 0 ? 207 : 200 });
}
