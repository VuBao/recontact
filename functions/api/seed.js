function authorized(request, env) {
  return Boolean(env.ADMIN_TOKEN) && request.headers.get("Authorization") === `Bearer ${env.ADMIN_TOKEN}`;
}
const pilot = [
  ["YAMADA AKI", "aki@example.test", "N2", ["Nhà hàng", "特定技能"]],
  ["TRAN MINH HIEU", "hieu@example.test", "N3", ["Nhà hàng", "Ưu tiên"]],
  ["NGUYEN THU HA", "ha@example.test", "N1", ["Lễ tân", "N1–N2"]],
  ["LE QUOC AN", "an@example.test", "N2", ["Kỹ sư", "N1–N2"]],
  ["PHAM MAI LAN", "lan@example.test", "N3", ["Nhà hàng", "Du học"]],
  ["DO ANH TU", "tu@example.test", "N2", ["特定技能", "Ưu tiên"]],
  ["VU KHANH LINH", "linh@example.test", "N1", ["Lễ tân", "N1–N2"]],
  ["HOANG QUOC VIET", "viet@example.test", "N3", ["Nhà hàng"]],
  ["BUI THAO MY", "my@example.test", "N2", ["特定技能"]],
  ["DANG GIA BAO", "bao@example.test", "N2", ["Kỹ sư"]]
];
export async function onRequestPost(context) {
  if (!authorized(context.request, context.env)) return new Response("Unauthorized", { status: 401 });
  if (!context.env.DB) return Response.json({ error: "D1 binding DB is not configured." }, { status: 503 });
  const statements = pilot.map(([full_name, email, japanese_level, labels]) =>
    context.env.DB.prepare("INSERT OR IGNORE INTO candidates (id, full_name, email, japanese_level, labels_json, source) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(`pilot-${email}`, full_name, email, japanese_level, JSON.stringify(labels), "pilot")
  );
  await context.env.DB.batch(statements);
  return Response.json({ imported: pilot.length, message: "Pilot data ready." });
}