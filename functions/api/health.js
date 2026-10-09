export async function onRequestGet(context) {
  const ready = Boolean(context.env.DB && context.env.CV_BUCKET);
  return Response.json({
    service: "Recontact data layer",
    ready,
    bindings: { database: Boolean(context.env.DB), cvStorage: Boolean(context.env.CV_BUCKET) },
    message: ready ? "Ready for pilot import." : "Configure DB and CV_BUCKET bindings first."
  }, { headers: { "Cache-Control": "no-store" } });
}