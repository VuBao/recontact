const LABELS = Object.freeze({
  name: "氏名：",
  phone: "電話番号：",
  availability: "電話に出られる曜日・時間：",
  startDate: "勤務開始可能日："
});

function normalize(value) {
  return String(value ?? "").replace(/\r\n?/g, "\n").replace(/\uFEFF/g, "");
}

export function parseCandidateResponse(text) {
  const lines = normalize(text).split("\n");
  const values = { name: "", phone: "", availability: "", startDate: "" };
  for (const line of lines) {
    const trimmed = line.trim();
    for (const [key, label] of Object.entries(LABELS)) {
      if (trimmed.startsWith(label)) {
        values[key] = trimmed.slice(label.length).trim();
        break;
      }
    }
  }
  const found = Object.values(values).some(Boolean);
  return found ? values : null;
}

export function responseLabels() {
  return LABELS;
}
