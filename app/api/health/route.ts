// Lightweight health check for Docker / load-balancer probes.
// No DB dependency — intentionally minimal so the probe passes even if the
// DB connection is slow to initialise.
export const dynamic = "force-dynamic";

export function GET() {
  return new Response(JSON.stringify({ status: "ok" }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
