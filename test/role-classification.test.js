import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { onRequestGet as getCandidates } from "../functions/api/candidates.js";
import { onRequestPost as importCv } from "../functions/api/import.js";
import { normalizeRoleTitle, roleTitleKey } from "../functions/lib/roles.js";

function request(url, options = {}) {
  return new Request(url, {
    ...options,
    headers: { "Cf-Access-Jwt-Assertion": "signed-access-jwt", ...options.headers }
  });
}

test("normalizes role titles without guessing folder aliases", () => {
  assert.equal(normalizeRoleTitle("  ホテルスタッフ\u3000 "), "ホテルスタッフ");
  assert.equal(roleTitleKey("  Hotel   Staff "), "hotel staff");
  assert.equal(normalizeRoleTitle("x".repeat(161)), null);
  assert.equal(normalizeRoleTitle("Line\nBreak"), null);
});

test("candidate listing exposes ready, missing, and ambiguous role states", async () => {
  const rows = [
    { id: "ready", full_name: "Ready", role_count: 1, role_id_value: "job-1", role_title_value: "ホテルスタッフ" },
    { id: "missing", full_name: "Missing", role_count: 0, role_id_value: null, role_title_value: null },
    { id: "ambiguous", full_name: "Ambiguous", role_count: 2, role_id_value: "job-2", role_title_value: "Ignored" }
  ];
  let sql;
  const response = await getCandidates({
    env: { DB: { prepare(statement) { sql = statement; return { async all() { return { results: rows }; } }; } } },
    request: request("https://example.test/api/candidates")
  });
  const result = await response.json();

  assert.match(sql, /LEFT JOIN job_candidates/);
  assert.match(sql, /j\.status = 'OPEN'/);
  assert.deepEqual(result.map(({ role_id, role_title, role_status }) => ({ role_id, role_title, role_status })), [
    { role_id: "job-1", role_title: "ホテルスタッフ", role_status: "READY" },
    { role_id: null, role_title: null, role_status: "ROLE_MISSING" },
    { role_id: null, role_title: null, role_status: "ROLE_AMBIGUOUS" }
  ]);
});

test("PDF import requires a valid role before reading the file", async () => {
  const form = new FormData();
  form.append("file", new File(["%PDF-1.4"], "candidate.pdf", { type: "application/pdf" }));
  const response = await importCv({
    env: { DB: {}, CV_BUCKET: {} },
    request: request("https://example.test/api/import", { method: "POST", body: form })
  });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "role_title is required." });
});

test("PDF import normalizes and persists a role assignment atomically", async () => {
  const calls = [];
  const db = {
    prepare(sql) {
      return {
        bind(...params) {
          return {
            async first() {
              if (sql.includes("WHERE file_hash")) return null;
              if (sql.includes("FROM jobs") && sql.includes("title_key")) return { id: "job-1", title: "ホテル スタッフ" };
              throw new Error(`Unhandled first query: ${sql}`);
            },
            async run() { calls.push({ sql, params }); }
          };
        }
      };
    },
    async batch(statements) { for (const statement of statements) await statement.run(); }
  };
  const bucket = { async put() {}, async delete() {} };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({
    output: [{ content: [{ type: "output_text", text: JSON.stringify({
      full_name: "TEST CANDIDATE", age: 25, phone: null, email: "test@example.com",
      current_visa: null, japanese_level: "N2"
    }) }] }]
  });

  try {
    const form = new FormData();
    form.append("file", new File(["%PDF-1.4 test"], "candidate.pdf", { type: "application/pdf" }));
    form.append("role_title", "  ホテル\u3000スタッフ  ");
    const response = await importCv({
      env: { DB: db, CV_BUCKET: bucket, OPENAI_API_KEY: "test" },
      request: request("https://example.test/api/import", { method: "POST", body: form })
    });
    const result = await response.json();
    assert.equal(response.status, 201);
    assert.equal(result.role_id, "job-1");
    assert.equal(result.role_title, "ホテル スタッフ");
    assert.ok(calls.some(call => call.sql.includes("INSERT OR IGNORE INTO jobs") && call.params[2] === "ホテル スタッフ".toLowerCase()));
    assert.ok(calls.some(call => call.sql.includes("INSERT INTO job_candidates")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("folder backfill reports matched, unmatched, duplicate-hash, and unmapped PDFs", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "recontact-role-backfill-"));
  const pdfDir = path.join(root, "hotel-folder");
  const restaurantDir = path.join(root, "restaurant-folder");
  const unknownDir = path.join(root, "unknown-folder");
  await Promise.all([mkdir(pdfDir), mkdir(restaurantDir), mkdir(unknownDir)]);
  const matched = "%PDF-1.4 matched";
  const duplicate = "%PDF-1.4 duplicate";
  await Promise.all([
    writeFile(path.join(pdfDir, "matched.pdf"), matched),
    writeFile(path.join(pdfDir, "duplicate-a.pdf"), duplicate),
    writeFile(path.join(pdfDir, "duplicate-b.pdf"), duplicate),
    writeFile(path.join(restaurantDir, "unmatched.pdf"), "%PDF-1.4 no candidate"),
    writeFile(path.join(unknownDir, "unmapped.pdf"), "%PDF-1.4 unmapped")
  ]);
  await writeFile(path.join(root, "mapping.json"), JSON.stringify({
    "hotel-folder": "ホテルスタッフ", "restaurant-folder": "レストランスタッフ"
  }));
  const digest = value => createHash("sha256").update(value).digest("hex");
  await writeFile(path.join(root, "candidates.json"), JSON.stringify([
    { id: "candidate-1", file_hash: digest(matched) },
    { id: "candidate-2", file_hash: digest(duplicate) }
  ]));

  const result = spawnSync("python3", [
    "tools/backfill_roles_from_folders.py", "--root", root, "--mapping", path.join(root, "mapping.json"),
    "--candidate-hashes", path.join(root, "candidates.json")
  ], { cwd: new URL("..", import.meta.url), encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.mode, "dry-run");
  assert.deepEqual(report.counts, { matched: 1, unmatched: 1, ambiguous: 1, unmapped: 1 });
  assert.equal(report.proposals[0].candidate_id, "candidate-1");
});

test("folder backfill apply is idempotent on a disposable D1-compatible database", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "recontact-role-apply-"));
  const pdfDir = path.join(root, "hotel-folder");
  const database = path.join(root, "test.sqlite");
  await mkdir(pdfDir);
  const contents = "%PDF-1.4 apply";
  await writeFile(path.join(pdfDir, "candidate.pdf"), contents);
  await writeFile(path.join(root, "mapping.json"), JSON.stringify({ "hotel-folder": "ホテルスタッフ" }));
  const hash = createHash("sha256").update(contents).digest("hex");
  const setup = spawnSync("python3", ["-c", [
    "import sqlite3,sys", "db=sqlite3.connect(sys.argv[1])",
    "db.executescript(open('schema.sql', encoding='utf-8').read())",
    "db.execute(\"INSERT INTO candidates (id,full_name,file_hash) VALUES ('candidate-1','Test',?)\",(sys.argv[2],))",
    "db.commit()"
  ].join(";"), database, hash], { cwd: new URL("..", import.meta.url), encoding: "utf8" });
  assert.equal(setup.status, 0, setup.stderr);

  const args = [
    "tools/backfill_roles_from_folders.py", "--root", root, "--mapping", path.join(root, "mapping.json"),
    "--database", database, "--apply"
  ];
  const first = spawnSync("python3", args, { cwd: new URL("..", import.meta.url), encoding: "utf8" });
  const second = spawnSync("python3", args, { cwd: new URL("..", import.meta.url), encoding: "utf8" });
  assert.equal(first.status, 0, first.stderr);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(JSON.parse(first.stdout).counts.applied, 1);
  assert.equal(JSON.parse(second.stdout).counts.applied, 0);
});
