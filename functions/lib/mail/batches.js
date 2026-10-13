export async function createBatch(db, {
  id,
  idempotencyKey,
  requestFingerprint,
  provider,
  companyName,
  attachmentNames,
  requestedCount
}) {
  const batchId = id || crypto.randomUUID();
  await db.prepare(`
    INSERT INTO email_batches (
      id, idempotency_key, request_fingerprint, provider, company_name,
      attachment_names_json, status, requested_count, sent_count, failed_count
    ) VALUES (?, ?, ?, ?, ?, ?, 'PROCESSING', ?, 0, 0)
  `).bind(
    batchId,
    idempotencyKey,
    requestFingerprint,
    provider,
    companyName,
    JSON.stringify(attachmentNames ?? []),
    requestedCount
  ).run();

  return {
    id: batchId,
    idempotency_key: idempotencyKey,
    request_fingerprint: requestFingerprint,
    provider,
    company_name: companyName,
    attachment_names_json: JSON.stringify(attachmentNames ?? []),
    status: "PROCESSING",
    requested_count: requestedCount,
    sent_count: 0,
    failed_count: 0
  };
}

export async function getBatchByIdempotencyKey(db, idempotencyKey) {
  return await db.prepare(`
    SELECT id, idempotency_key, request_fingerprint, provider, company_name,
           attachment_names_json, status, requested_count, sent_count, failed_count,
           created_at, completed_at
    FROM email_batches
    WHERE idempotency_key = ?
  `).bind(idempotencyKey).first() || null;
}

export async function getBatchDeliveries(db, batchId) {
  const result = await db.prepare(`
    SELECT id, batch_id, candidate_id, recipient_email, candidate_name, role_title,
           subject, body_text, status, error_code, error_message,
           provider_message_id, sent_at, created_at
    FROM email_deliveries
    WHERE batch_id = ?
    ORDER BY created_at, id
  `).bind(batchId).all();
  return result.results || [];
}

export async function insertDeliveries(db, batchId, deliveries) {
  if (!deliveries.length) return [];
  const statements = deliveries.map(delivery => {
    delivery.id ||= crypto.randomUUID();
    return db.prepare(`
      INSERT INTO email_deliveries (
        id, batch_id, candidate_id, recipient_email, candidate_name,
        role_title, subject, body_text, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')
    `).bind(
      delivery.id,
      batchId,
      delivery.candidate_id,
      delivery.recipient_email,
      delivery.candidate_name,
      delivery.role_title,
      delivery.subject,
      delivery.body_text
    );
  });
  await db.batch(statements);
  return deliveries;
}

export async function updateDelivery(db, deliveryId, {
  status,
  errorCode = null,
  errorMessage = null,
  providerMessageId = null,
  sentAt = null
}) {
  await db.prepare(`
    UPDATE email_deliveries
    SET status = ?, error_code = ?, error_message = ?, provider_message_id = ?, sent_at = ?
    WHERE id = ?
  `).bind(status, errorCode, errorMessage, providerMessageId, sentAt, deliveryId).run();
}

export async function finalizeBatch(db, batchId, { status, sentCount, failedCount, completedAt }) {
  await db.prepare(`
    UPDATE email_batches
    SET status = ?, sent_count = ?, failed_count = ?, completed_at = ?
    WHERE id = ?
  `).bind(
    status,
    sentCount,
    failedCount,
    completedAt || new Date().toISOString(),
    batchId
  ).run();
}
