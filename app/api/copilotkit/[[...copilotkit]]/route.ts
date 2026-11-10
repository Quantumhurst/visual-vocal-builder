import {
  BuiltInAgent,
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { checkOrigin, clientKey, createRateLimiter } from "../../../../lib/request-guard";
import { VVB_SYSTEM_PROMPT } from "../../../../lib/agent-prompt";
import { BRAIN_MODEL } from "../../../../lib/gemini-models";

const copilotLimiter = createRateLimiter({ limit: 60, windowMs: 60_000 });

function guard(req: Request): Response | null {
  if (!checkOrigin(req.headers.get("origin"), req.headers.get("host"))) return Response.json({ error: "forbidden origin" }, { status: 403 });
  const rl = copilotLimiter(clientKey(req));
  if (!rl.ok) return Response.json({ error: "rate limited" }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });
  return null;
}

// Server-only route. The key is read from the server environment and never
// leaves the server. The brain is Gemini Flash via the Google Generative AI API.
// The runtime and its agents are constructed per request, after the key check,
// so importing this route never throws in a keyless dev boot.
function buildHandler(_isVoiceTurn = false) {
  const apiKey = process.env.GEMINI_API_KEY || process.env.META_API_KEY;
  if (!apiKey) return null;

  const google = createGoogleGenerativeAI({ apiKey });
  const model = google(BRAIN_MODEL);

  const agentConfig = {
    model,
    prompt: VVB_SYSTEM_PROMPT,
  };

  // Register the agent the UI binds to (useAgent agentId "vvb") alongside
  // "default" (the provider default). Both share the same model
  // construction and prompt.
  const runtime = new CopilotRuntime({
    agents: {
      default: new BuiltInAgent(agentConfig),
      vvb: new BuiltInAgent(agentConfig),
    },
  });
  return createCopilotRuntimeHandler({ runtime, basePath: "/api/copilotkit" });
}

const KEY_MISSING = () =>
  Response.json(
    { error: "GEMINI_API_KEY is not configured on the server" },
    { status: 500 },
  );

export async function POST(req: Request) {
  const blocked = guard(req); if (blocked) return blocked;
  const isVoiceTurn = req.headers.get("x-voice-turn") === "1";
  const handleRequest = buildHandler(isVoiceTurn);
  if (!handleRequest) return KEY_MISSING();
  return handleRequest(req);
}

// Agent discovery (GET /api/copilotkit/info) and every other subpath of
// this catch-all segment are served by the same multi-route handler.
export async function GET(req: Request) {
  const blocked = guard(req); if (blocked) return blocked;
  const handleRequest = buildHandler(false);
  if (!handleRequest) return KEY_MISSING();
  return handleRequest(req);
}
