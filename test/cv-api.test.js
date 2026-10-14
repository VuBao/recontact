import assert from "node:assert/strict";
import test from "node:test";
import { onRequestGet as getCv } from "../functions/api/cv.js";

function context({ access = true, candidate = { file_key: "cv/candidate.pdf", file_name: "candidate.pdf" } } = {}) {
  return {
    request: new Request("https://example.test/api/cv?id=candidate-1", {
      headers: access ? { "Cf-Access-Jwt-Assertion": "signed-access-jwt" } : {}
    }),
    env: {
      DB: {
        prepare() {
          return { bind() { return { first: async () => candidate }; } };
        }
      },
      CV_BUCKET: {
        async get() {
          const response = new Response("%PDF-1.4 test");
          return {
            body: response.body,
            writeHttpMetadata(headers) { headers.set("Content-Length", "14"); }
          };
        }
      }
    }
  };
}

test("serves the private CV as an inline PDF for an authenticated request", async () => {
  const response = await getCv(context());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/pdf");
  assert.match(response.headers.get("content-disposition"), /inline/);
  assert.equal(await response.text(), "%PDF-1.4 test");
});

test("does not expose CV files without Cloudflare Access authentication", async () => {
  const response = await getCv(context({ access: false }));
  assert.equal(response.status, 401);
});
