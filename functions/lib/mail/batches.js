export async function createBatch(db, { id, idempotencyKey, companyName, totalCount }) {
  const batchId = id || crypto.randomUUID();
  await db.prepare(
    `INSERT INTO email_batches (id, idempotency_key, company_name, status, total_count, sent_count, failed_count)
     VALUES (?, ?, ?, 'PROCESSING', ?, 0, 0)`
  ).bind(batchId, idempotencyKey, companyName, totalCount).run();

  return {
    id: batchId,
    idempotency_key: idempotencyKey,
    company_name: companyName,
    status: "PROCESSING",
    total_count: totalCount,
    sent_count: 0,
    failed_count: 0
  };
}

export async function getBatchByIdempotencyKey(db, idempotencyKey) {
  const batch = await db.prepare(
    `SELECT id, idempotency_key, company_name, status, total_count, sent_count, failed_count, created_at, completed_at
     FROM email_batches WHERE idempotency_key = ?`
  ).bind(idempotencyKey).first();
  return batch || null;
}

export async function getBatchDeliveries(db, batchId) {
  const result = await db.prepare(
    `SELECT id, batch_id, candidate_id, recipient_email, recipient_name, status, error_message, provider_message_id, sent_at, created_at
     FROM email_deliveries WHERE batch_id = ? ORDER BY created_at ASC`
  ).bind(batchId).all();
  return result.results || [];
}

export async function insertDeliveries(db, batchId, deliveries) {
  if (!deliveries.length) return [];
  const statements = deliveries.map(delivery => {
    const deliveryId = delivery.id || crypto.randomUUID();
    delivery.id = deliveryId;
    return db.prepare(
      `INSERT INTO email_deliveries (id, batch_id, candidate_id, recipient_email, recipient_name, status)
       VALUES (?, ?, ?, ?, ?, 'PENDING')`
    ).bind(deliveryId, batchId, delivery.candidate_id, delivery.recipient_email, delivery.recipient_name);
  });
  await db.batch(statements);
  return deliveries;
}

export async function updateDelivery(db, deliveryId, { status, errorMessage, providerMessageId, sentAt }) {
  await db.prepare(
    `UPDATE email_deliveries
     SET status = ?, error_message = ?, provider_message_id = ?, sent_at = ?
     WHERE id = ?`
  ).bind(
    status,
    errorMessage || null,
    providerMessageId || null,
    sentAt || null,
    deliveryId
  ).run();
}

export async function finalizeBatch(db, batchId, { status, sentCount, failedCount, completedAt }) {
  const timestamp = completedAt || new Date().toISOString();
  await db.prepare(
    `UPDATE email_batches
     SET status = ?, sent_count = ?, failed_count = ?, completed_at = ?
     WHERE id = ?`
  ).bind(status, sentCount, failedCount, timestamp, batchId).run();
}
