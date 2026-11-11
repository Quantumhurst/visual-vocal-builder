import { checkOrigin } from "../../../lib/request-guard.ts";
import { providerInfo, resolveProvider } from "../../../lib/provider.ts";

// Tells the browser which engines the server is configured for, so the
// client opens the right speech path. Reads the request headers, so it is
// answered per request and never baked in at build time. No key leaves
// the server.
export async function GET(req: Request) {
  if (!checkOrigin(req.headers.get("origin"), req.headers.get("host"))) {
    return Response.json({ error: "forbidden origin" }, { status: 403 });
  }
  const resolved = resolveProvider();
  if (!resolved.ok) {
    return Response.json({ error: resolved.error }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
  return Response.json(providerInfo(resolved.provider), { headers: { "Cache-Control": "no-store" } });
}
