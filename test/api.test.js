import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

import { onRequestGet as getJobs, onRequestPost as createJob } from "../functions/api/jobs.js";
import {
  onRequestGet as getAssignments,
  onRequestPatch as updateAssignment,
  onRequestPost as createAssignment
} from "../functions/api/job-candidates.js";

class FakeDB {
  constructor() {
    this.jobs = [];
    this.candidates = [{ id: "candidate-1", full_name: "Test Candidate", labels_json: "[]" }];
    this.assignments = [];
  }

  prepare(sql) {
    const db = this;
    return {
      async all() {
        if (sql.includes("FROM jobs ORDER BY")) return { results: db.jobs };
        throw new Error(`Unhandled direct all query: ${sql}`);
      },
      bind(...params) {
        return {
          async all() {
            if (sql.includes("FROM jobs ORDER BY")) return { results: db.jobs };
            if (sql.includes("FROM job_candidates jc")) {
              const [jobId] = params;
              return {
                results: db.assignments.filter(item => item.job_id === jobId).map(item => ({
                  ...item,
                  ...db.candidates.find(candidate => candidate.id === item.candidate_id),
                  labels_json: "[]"
                }))
              };
            }
            throw new Error(`Unhandled all query: ${sql}`);
          },
          async first() {
            if (sql.includes("SELECT id FROM jobs")) return db.jobs.find(item => item.id === params[0]) || null;
            if (sql.includes("SELECT id FROM candidates")) return db.candidates.find(item => item.id === params[0]) || null;
            if (sql.includes("WHERE job_id = ? AND candidate_id = ?")) return db.assignments.find(item => item.job_id === params[0] && item.candidate_id === params[1]) || null;
            if (sql.includes("SELECT id, status FROM job_candidates")) return db.assignments.find(item => item.id === params[0]) || null;
            throw new Error(`Unhandled first query: ${sql}`);
          },
          async run() {
            if (sql.includes("INSERT INTO jobs")) {
              db.jobs.push({ id: params[0], title: params[1], location: params[2], status: "OPEN", created_at: "now" });
              return;
            }
            if (sql.includes("INSERT OR IGNORE INTO job_candidates")) {
              if (!db.assignments.some(item => item.job_id === params[1] && item.candidate_id === params[2])) {
                db.assignments.push({ id: params[0], job_id: params[1], candidate_id: params[2], status: "SELECTED", created_at: "now" });
              }
              return;
            }
            if (sql.includes("UPDATE job_candidates SET status")) {
              const item = db.assignments.find(assignment => assignment.id === params[1]);
              item.status = params[0];
              return;
            }
            throw new Error(`Unhandled run query: ${sql}`);
          }
        };
      }
    };
  }
}

function context(db, method, path, body) {
  return {
    env: { DB: db, ADMIN_TOKEN: "test-token" },
    request: new Request(`https://example.test${path}`, {
      method,
      headers: { Authorization: "Bearer test-token", ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined
    })
  };
}

test("creates and lists persistent jobs", async () => {
  const db = new FakeDB();
  const created = await createJob(context(db, "POST", "/api/jobs", { title: "Nhà hàng", location: "Tokyo" }));
  assert.equal(created.status, 201);
  const job = await created.json();
  assert.equal(job.title, "Nhà hàng");

  const listed = await getJobs(context(db, "GET", "/api/jobs"));
  assert.equal((await listed.json()).length, 1);
});

test("persists an assignment and enforces sequential status transitions", async () => {
  const db = new FakeDB();
  const jobResponse = await createJob(context(db, "POST", "/api/jobs", { title: "Kỹ sư" }));
  const job = await jobResponse.json();

  const created = await createAssignment(context(db, "POST", "/api/job-candidates", { job_id: job.id, candidate_id: "candidate-1" }));
  assert.equal(created.status, 201);
  const assignment = await created.json();
  assert.equal(assignment.status, "SELECTED");

  const sent = await updateAssignment(context(db, "PATCH", "/api/job-candidates", { id: assignment.id, status: "SENT" }));
  assert.equal(sent.status, 200);

  const invalidJump = await updateAssignment(context(db, "PATCH", "/api/job-candidates", { id: assignment.id, status: "BOOKED" }));
  assert.equal(invalidJump.status, 409);

  const listed = await getAssignments(context(db, "GET", `/api/job-candidates?job_id=${job.id}`));
  const rows = await listed.json();
  assert.equal(rows[0].status, "SENT");
  assert.equal(rows[0].full_name, "Test Candidate");
});

test("browser script parses as valid JavaScript", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const script = html.match(/<script>([\s\S]*)<\/script>/)?.[1];
  assert.ok(script);
  assert.doesNotThrow(() => new vm.Script(script));
});
