export class FakeMailDB {
  constructor() {
    this.candidates = [
      { id: "cand-1", full_name: "Nguyễn Văn An", email: "an@example.test" },
      { id: "cand-2", full_name: "山田 太郎", email: "yamada@example.test" },
      { id: "cand-no-email", full_name: "No Mail", email: null },
      { id: "cand-bad-email", full_name: "Bad Mail", email: "invalid" },
      { id: "cand-no-role", full_name: "No Role", email: "norole@example.test" },
      { id: "cand-many-roles", full_name: "Many Roles", email: "many@example.test" }
    ];
    this.roles = [
      { candidate_id: "cand-1", role_id: "role-1", role_title: "ホテルスタッフ" },
      { candidate_id: "cand-2", role_id: "role-2", role_title: "フロント" },
      { candidate_id: "cand-no-email", role_id: "role-1", role_title: "ホテルスタッフ" },
      { candidate_id: "cand-bad-email", role_id: "role-1", role_title: "ホテルスタッフ" },
      { candidate_id: "cand-many-roles", role_id: "role-1", role_title: "ホテルスタッフ" },
      { candidate_id: "cand-many-roles", role_id: "role-2", role_title: "フロント" }
    ];
    this.batches = [];
    this.deliveries = [];
  }

  prepare(sql) {
    const db = this;
    return {
      bind(...params) {
        return {
          async first() {
            if (sql.includes("FROM email_batches") && sql.includes("idempotency_key = ?")) {
              return db.batches.find(batch => batch.idempotency_key === params[0]) || null;
            }
            throw new Error(`Unhandled first query: ${sql}`);
          },
          async all() {
            if (sql.includes("FROM candidates c") && sql.includes("LEFT JOIN job_candidates")) {
              const rows = [];
              for (const candidate of db.candidates.filter(item => params.includes(item.id))) {
                const roles = db.roles.filter(role => role.candidate_id === candidate.id);
                if (!roles.length) rows.push({ ...candidate, role_id: null, role_title: null });
                else for (const role of roles) rows.push({ ...candidate, ...role });
              }
              return { results: rows };
            }
            if (sql.includes("FROM email_deliveries") && sql.includes("batch_id = ?")) {
              return { results: db.deliveries.filter(delivery => delivery.batch_id === params[0]) };
            }
            throw new Error(`Unhandled all query: ${sql}`);
          },
          async run() {
            if (sql.includes("INSERT INTO email_batches")) {
              db.batches.push({
                id: params[0],
                idempotency_key: params[1],
                request_fingerprint: params[2],
                provider: params[3],
                company_name: params[4],
                attachment_names_json: params[5],
                status: "PROCESSING",
                requested_count: params[6],
                sent_count: 0,
                failed_count: 0
              });
              return;
            }
            if (sql.includes("INSERT INTO email_deliveries")) {
              db.deliveries.push({
                id: params[0],
                batch_id: params[1],
                candidate_id: params[2],
                recipient_email: params[3],
                candidate_name: params[4],
                role_title: params[5],
                subject: params[6],
                body_text: params[7],
                status: "PENDING",
                error_code: null,
                error_message: null,
                provider_message_id: null,
                sent_at: null,
                created_at: new Date().toISOString()
              });
              return;
            }
            if (sql.includes("UPDATE email_deliveries")) {
              const delivery = db.deliveries.find(item => item.id === params[5]);
              Object.assign(delivery, {
                status: params[0],
                error_code: params[1],
                error_message: params[2],
                provider_message_id: params[3],
                sent_at: params[4]
              });
              return;
            }
            if (sql.includes("UPDATE email_batches")) {
              const batch = db.batches.find(item => item.id === params[4]);
              Object.assign(batch, {
                status: params[0],
                sent_count: params[1],
                failed_count: params[2],
                completed_at: params[3]
              });
              return;
            }
            throw new Error(`Unhandled run query: ${sql}`);
          }
        };
      }
    };
  }

  async batch(statements) {
    for (const statement of statements) await statement.run();
  }
}

export function authHeaders(extra = {}) {
  return { "Cf-Access-Jwt-Assertion": "test-jwt", ...extra };
}

export function pdfFile(name = "job.pdf", contents = "details") {
  return new File([new TextEncoder().encode(`%PDF-1.4\n${contents}`)], name, {
    type: "application/pdf"
  });
}

export function sendForm(payload, attachments = []) {
  const form = new FormData();
  form.append("payload", JSON.stringify(payload));
  for (const attachment of attachments) form.append("attachments", attachment);
  return form;
}
