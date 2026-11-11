import { handleTranscribe } from "../../../lib/transcribe-handler";
import { createRateLimiter } from "../../../lib/request-guard";
import { transcribePcm as geminiTranscribePcm } from "../../../lib/gemini-asr";
import { transcribePcm as metaTranscribePcm } from "../../../lib/meta-asr";
import { resolveProvider } from "../../../lib/provider";

// Keep ws on its pure-JS masking path in every runtime (see next.config.ts).
process.env.WS_NO_BUFFER_UTIL = "true";

// NOTE: no `export const runtime` here — route handlers already run on the
// Node.js runtime by default, and Next 16's Cache Components rejects an
// explicit runtime export on this route.

// Server-only route. The provider key is read from the server environment
// and never leaves the server: it is never sent to the browser, never
// logged, and never written to a file.

const limiter = createRateLimiter({ limit: 20, windowMs: 60_000 });

export async function POST(req: Request) {
  const resolved = resolveProvider();
  if (!resolved.ok) {
    return Response.json({ error: resolved.error }, { status: 500 });
  }
  const { provider, apiKey } = resolved;
  return handleTranscribe(req, {
    limiter,
    provider,
    transcribe: (pcm) =>
      provider === "meta" ? metaTranscribePcm(pcm, apiKey) : geminiTranscribePcm(pcm, apiKey),
  });
}
