import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

test("CV links use the authenticated in-page viewer flow", () => {
  assert.match(html, /data-cv-id=/);
  assert.match(html, /openCv\(/);
  assert.match(html, /fetch\(path,\{\.\.\.options,headers,credentials:'same-origin'\}\)/);
});
