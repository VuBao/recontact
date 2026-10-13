export function renderCandidateEmail({ candidate, companyName }) {
  const name = candidate.full_name || "Ứng viên";
  const level = candidate.japanese_level ? ` (Trình độ: ${candidate.japanese_level})` : "";
  const company = companyName || "Công ty";

  const subject = `[${company}] Cơ hội nghề nghiệp phù hợp - ${name}`;
  const text = `Xin chào ${name},

Chúng tôi liên hệ từ ${company}${level}.
Chúng tôi rất ấn tượng với hồ sơ của bạn và muốn trao đổi thêm về các vị trí phù hợp tại Nhật Bản / Việt Nam.

Trân trọng,
${company}`;

  const html = `<p>Xin chào <strong>${name}</strong>,</p>
<p>Chúng tôi liên hệ từ <strong>${company}</strong>${level}.</p>
<p>Chúng tôi rất ấn tượng với hồ sơ của bạn và muốn trao đổi thêm về các vị trí phù hợp tại Nhật Bản / Việt Nam.</p>
<p>Trân trọng,<br><strong>${company}</strong></p>`;

  return {
    subject,
    text,
    html,
    role: candidate.japanese_level || "Ứng viên"
  };
}
