/** CORS for the browser-facing /api/order endpoint. */
export function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": process.env.ALLOWED_ORIGIN || "https://bistro-cloud.com",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

export function preflight(): Response {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export function jsonWithCors(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}
