import { handleTts } from "../../../lib/tts-handler.ts";
import { resolveProvider } from "../../../lib/provider.ts";

// Server-only route: the Gemini neural host voice. The key is read from
// the server environment and never leaves the server. In Meta mode this
// answers 501 and the browser voice speaks instead.
export async function POST(req: Request): Promise<Response> {
  return handleTts(req, { resolve: () => resolveProvider() });
}
