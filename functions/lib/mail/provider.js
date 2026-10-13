/**
 * Provider-neutral mail dispatcher
 */
export async function sendEmail(env, { to, toName, subject, text, html, attachments }) {
  if (env && env.MAIL_PROVIDER && typeof env.MAIL_PROVIDER.send === "function") {
    return await env.MAIL_PROVIDER.send({ to, toName, subject, text, html, attachments });
  }

  // If GMAIL credentials are configured, we can use Gmail API
  if (env?.GMAIL_CLIENT_ID && env?.GMAIL_CLIENT_SECRET && env?.GMAIL_REFRESH_TOKEN) {
    return await sendViaGmail(env, { to, toName, subject, text, html, attachments });
  }

  // Fallback / simulation when running locally without external provider
  if (env?.ENVIRONMENT === "local" || !env?.GMAIL_CLIENT_ID) {
    return {
      id: `sim-${crypto.randomUUID()}`,
      status: "sent"
    };
  }

  throw new Error("No email provider configured.");
}

async function sendViaGmail(env, { to, toName, subject, text, html, attachments }) {
  // Exchange refresh token for access token
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GMAIL_CLIENT_ID,
      client_secret: env.GMAIL_CLIENT_SECRET,
      refresh_token: env.GMAIL_REFRESH_TOKEN,
      grant_type: "refresh_token"
    })
  });

  if (!tokenRes.ok) {
    const errorBody = await tokenRes.text().catch(() => "");
    const err = new Error("Failed to authenticate with Gmail OAuth.");
    err.status = tokenRes.status;
    err.details = errorBody;
    throw err;
  }

  const tokenData = await tokenRes.json();
  const accessToken = tokenData.access_token;

  // Build MIME message
  const boundary = `====_recontact_${Date.now()}_====`;
  const recipient = toName ? `"${toName.replace(/"/g, "")}" <${to}>` : to;
  let rawMessage = [
    `To: ${recipient}`,
    `Subject: =?UTF-8?B?${btoa(unescape(encodeURIComponent(subject)))}?=`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    `Content-Type: text/html; charset=UTF-8`,
    `Content-Transfer-Encoding: base64`,
    "",
    btoa(unescape(encodeURIComponent(html || text || "")))
  ].join("\r\n");

  for (const att of attachments || []) {
    const b64 = bytesToBase64(att.bytes);
    rawMessage += "\r\n" + [
      `--${boundary}`,
      `Content-Type: ${att.contentType || "application/pdf"}; name="${att.filename}"`,
      `Content-Disposition: attachment; filename="${att.filename}"`,
      `Content-Transfer-Encoding: base64`,
      "",
      b64
    ].join("\r\n");
  }

  rawMessage += `\r\n--${boundary}--\r\n`;

  const encoded = btoa(rawMessage)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const sendRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ raw: encoded })
  });

  if (!sendRes.ok) {
    const errText = await sendRes.text().catch(() => "");
    const err = new Error("Gmail API delivery failed.");
    err.status = sendRes.status;
    err.details = errText;
    throw err;
  }

  const result = await sendRes.json();
  return { id: result.id, status: "sent" };
}

function bytesToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 32768) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
  }
  return btoa(binary);
}
