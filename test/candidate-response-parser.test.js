import assert from "node:assert/strict";
import test from "node:test";
import { parseCandidateResponse } from "../functions/lib/mail/response-parser.js";
import { createGmailReader } from "../functions/lib/mail/gmail.js";

test("parses only the four fixed Japanese response labels", () => {
  assert.deepEqual(parseCandidateResponse([
    "氏名： 山田 太郎",
    "電話番号： 090-1234-5678",
    "電話に出られる曜日・時間： 平日 18:00以降",
    "勤務開始可能日： 2026年11月1日",
    "自由記述：無視する"
  ].join("\r\n")), {
    name: "山田 太郎",
    phone: "090-1234-5678",
    availability: "平日 18:00以降",
    startDate: "2026年11月1日"
  });
});

test("returns partial fixed-label replies and ignores unrelated text", () => {
  assert.deepEqual(parseCandidateResponse("こんにちは\n氏名：\n電話番号： 080-0000-0000"), {
    name: "",
    phone: "080-0000-0000",
    availability: "",
    startDate: ""
  });
  assert.equal(parseCandidateResponse("自由記述だけです"), null);
});

test("Gmail reader decodes UTF-8 reply bodies without using an LLM", async () => {
  const calls = [];
  const body = btoa(String.fromCharCode(...new TextEncoder().encode("氏名： 山田 太郎\n電話番号： 090")));
  const fetchImpl = async (url) => {
    calls.push(String(url));
    if (String(url).includes("oauth2.googleapis.com")) return Response.json({ access_token: "token", expires_in: 3600 });
    if (String(url).includes("maxResults")) return Response.json({ messages: [{ id: "m1" }] });
    return Response.json({ id: "m1", internalDate: "1760000000000", payload: { headers: [{ name: "From", value: "candidate@example.com" }], mimeType: "text/plain", body: { data: body } } });
  };
  const reader = createGmailReader({ GMAIL_CLIENT_ID: "id", GMAIL_CLIENT_SECRET: "secret", GMAIL_REFRESH_TOKEN: "refresh" }, { fetchImpl });
  const messages = await reader.recentMessages();
  assert.match(messages[0].text, /氏名： 山田 太郎/);
  assert.equal(calls.length, 3);
});
