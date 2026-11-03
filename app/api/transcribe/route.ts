import { handleTranscribe } from "../../../lib/transcribe-handler";
import { createRateLimiter } from "../../../lib/request-guard";
import { transcribePcm } from "../../../lib/meta-asr";

// Keep ws on its pure-JS masking path in every runtime (see next.config.ts).
process.env.WS_NO_BUFFER_UTIL = "true";

// NOTE: no `export const runtime` here — route handlers already run on the
// Node.js runtime by default, and Next 16's Cache Components rejects an
// explicit runtime export on this route.

// Server-only route. The Meta Model API key is read from the server
// environment and never leaves the server: it is never sent to the browser,
// never logged, and never written to a file.

const limiter = createRateLimiter({ limit: 20, windowMs: 60_000 });

export async function POST(req: Request) {
  const apiKey = process.env.META_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "META_API_KEY is not configured on the server" },
      { status: 500 },
    );
  }
  return handleTranscribe(req, {
    limiter,
    transcribe: (pcm) => transcribePcm(pcm, apiKey),
  });
}
