export async function authorized(request) {
  const hostname = new URL(request.url).hostname;
  if (hostname === "127.0.0.1" || hostname === "localhost") return true;
  return Boolean(request.headers.get("Cf-Access-Jwt-Assertion"));
}
