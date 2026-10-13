import { authorized } from "../lib/auth.js";
import { ensureRole, normalizeRoleTitle } from "../lib/roles.js";

function safeFileName(name) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120);
}

async function sha256(buffer) {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 32768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  }
  return btoa(binary);
}

function responseText(response) {
  if (response.output_text) return response.output_text;
  for (const item of response.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && content.text) return content.text;
    }
  }
  return "";
}

async function extractProfile(file, buffer, env) {
  if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured.");
  const today = new Date().toISOString().slice(0, 10);
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: env.OPENAI_MODEL || "gpt-6-astra",
      store: false,
      input: [{
        role: "user",
        content: [
          {
            type: "input_file",
            filename: file.name,
            file_data: `data:application/pdf;base64,${toBase64(buffer)}`,
            detail: "low"
          },
          {
            type: "input_text",
            text: `Today is ${today}. Extract the candidate profile from this CV. Preserve the spelling in the CV. If only a birth date is available, calculate the current age. Return null for any field that is not present. Current visa means the candidate's present visa or residence status. Japanese level should be concise, for example N2.`
          }
        ]
      }],
      text: {
        format: {
          type: "json_schema",
          name: "cv_profile",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              full_name: { type: ["string", "null"] },
              age: { type: ["integer", "null"] },
              phone: { type: ["string", "null"] },
              email: { type: ["string", "null"] },
              current_visa: { type: ["string", "null"] },
              japanese_level: { type: ["string", "null"] }
            },
            required: ["full_name", "age", "phone", "email", "current_visa", "japanese_level"]
          }
        }
      }
    })
  });

  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message || "AI could not read this CV.");
  const text = responseText(result);
  if (!text) throw new Error("AI returned no profile data.");
  return JSON.parse(text);
}

async function extractProfileLocally(buffer) {
  const response = await fetch("http://127.0.0.1:8790/extract", {
    method: "POST",
    headers: { "Content-Type": "application/pdf" },
    body: buffer
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Local PDF extractor could not read this CV.");
  return result;
}

export async function onRequestPost(context) {
  if (!(await authorized(context.request, context.env))) return new Response("Unauthorized", { status: 401 });
  if (!context.env.DB || !context.env.CV_BUCKET) return Response.json({ error: "Storage bindings are not ready." }, { status: 503 });

  const form = await context.request.formData();
  const file = form.get("file");
  const roleTitle = normalizeRoleTitle(form.get("role_title"));
  if (!roleTitle) return Response.json({ error: "role_title is required." }, { status: 400 });
  if (!(file instanceof File)) return Response.json({ error: "A PDF file is required." }, { status: 400 });
  if (!/\.pdf$/i.test(file.name) || (file.type && file.type !== "application/pdf")) {
    return Response.json({ error: "Only PDF files are accepted." }, { status: 400 });
  }
  if (file.size > 15 * 1024 * 1024) return Response.json({ error: "Each PDF must be 15 MB or smaller." }, { status: 413 });

  const body = await file.arrayBuffer();
  const fileHash = await sha256(body);
  const duplicate = await context.env.DB.prepare(
    "SELECT id, full_name, age, phone, email, current_visa, japanese_level, file_name FROM candidates WHERE file_hash = ?"
  ).bind(fileHash).first();
  if (duplicate) {
    const role = await ensureRole(context.env.DB, roleTitle);
    await context.env.DB.prepare(
      "INSERT OR IGNORE INTO job_candidates (id, job_id, candidate_id, status) VALUES (?, ?, ?, 'SELECTED')"
    ).bind(crypto.randomUUID(), role.id, duplicate.id).run();
    return Response.json({ duplicate: true, candidate: { ...duplicate, role_id: role.id, role_title: role.title } });
  }

  const hostname = new URL(context.request.url).hostname;
  const localPreview = (hostname === "127.0.0.1" || hostname === "localhost") && !context.env.OPENAI_API_KEY;
  let profile;
  if (localPreview) {
    try {
      profile = await extractProfileLocally(body);
    } catch (error) {
      return Response.json({ error: error.message || "Local PDF extractor could not read this CV." }, { status: 502 });
    }
  } else {
    try {
      profile = await extractProfile(file, body, context.env);
    } catch (error) {
      return Response.json({ error: error.message || "AI could not read this CV." }, { status: 502 });
    }
  }

  const id = crypto.randomUUID();
  const fileKey = `cv/${id}/${safeFileName(file.name)}`;
  const fullName = String(profile.full_name || file.name.replace(/\.pdf$/i, "")).slice(0, 160);
  const age = Number.isInteger(profile.age) && profile.age >= 0 && profile.age <= 120 ? profile.age : null;
  const role = await ensureRole(context.env.DB, roleTitle);
  await context.env.CV_BUCKET.put(fileKey, body, { httpMetadata: { contentType: "application/pdf" } });
  try {
    const candidateInsert = context.env.DB.prepare(
      `INSERT INTO candidates
        (id, full_name, age, phone, email, current_visa, japanese_level, source, file_key, file_name, file_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id,
      fullName,
      age,
      profile.phone || null,
      profile.email || null,
      profile.current_visa || null,
      profile.japanese_level || null,
      localPreview ? "local_pdf_preview" : "ai_pdf_import",
      fileKey,
      file.name,
      fileHash
    );
    const assignmentInsert = context.env.DB.prepare(
      "INSERT INTO job_candidates (id, job_id, candidate_id, status) VALUES (?, ?, ?, 'SELECTED')"
    ).bind(crypto.randomUUID(), role.id, id);
    await context.env.DB.batch([candidateInsert, assignmentInsert]);
  } catch (error) {
    try {
      await context.env.DB.prepare("DELETE FROM candidates WHERE id = ?").bind(id).run();
    } catch {
      // D1 batch is atomic; this is only a defensive cleanup for compatible test adapters.
    }
    await context.env.CV_BUCKET.delete(fileKey);
    throw error;
  }

  return Response.json({
    id,
    full_name: fullName,
    age,
    phone: profile.phone || null,
    email: profile.email || null,
    current_visa: profile.current_visa || null,
    japanese_level: profile.japanese_level || null,
    file_name: file.name,
    role_id: role.id,
    role_title: role.title,
    local_preview: localPreview
  }, { status: 201 });
}
