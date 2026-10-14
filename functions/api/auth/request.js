import { authCookie, authCookies, configuredAuth, createChallenge, isStaffEmail, randomOtp } from "../../lib/auth.js";
import { createMailProvider } from "../../lib/mail/provider.js";

export async function onRequestPost(context) {
  if (!configuredAuth(context.env)) return Response.json({ error: "Application login is not configured." }, { status: 503 });
  const body = await context.request.json().catch(() => ({}));
  const email = String(body.email || "").trim().toLowerCase();
  if (!isStaffEmail(email, context.env)) return Response.json({ error: "Email này không được phép đăng nhập." }, { status: 403 });
  const otp = randomOtp();
  const challenge = await createChallenge(email, otp, context.env);
  try {
    const provider = createMailProvider(context.env);
    await provider.send({
      from: { email: context.env.MAIL_FROM_EMAIL, name: context.env.MAIL_FROM_NAME },
      to: { email },
      subject: "Mã đăng nhập Recontact",
      text: `Mã đăng nhập Recontact của bạn là: ${otp}\n\nMã có hiệu lực trong 10 phút. Nếu bạn không yêu cầu mã này, hãy bỏ qua email.`,
      attachments: []
    });
  } catch (error) {
    const code = error?.code || "PROVIDER_UNAVAILABLE";
    const message = code === "PROVIDER_AUTH_FAILED"
      ? "Kết nối Gmail đã hết hạn hoặc không hợp lệ. Hãy cấp lại Gmail OAuth trước khi gửi mã đăng nhập."
      : "Không thể gửi mã đăng nhập lúc này. Vui lòng thử lại sau.";
    return Response.json({ error: message, error_code: code }, { status: 503 });
  }
  return new Response(JSON.stringify({ sent: true }), {
    headers: { "Content-Type": "application/json", "Set-Cookie": authCookie(authCookies.CHALLENGE_COOKIE, challenge, authCookies.CHALLENGE_TTL_SECONDS) }
  });
}
