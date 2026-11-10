import {
  BuiltInAgent,
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import { createOpenAI } from "@ai-sdk/openai";
import { checkOrigin, clientKey, createRateLimiter } from "../../../../lib/request-guard";
import { VVB_SYSTEM_PROMPT } from "../../../../lib/agent-prompt";
import { BRAIN_MODEL } from "../../../../lib/meta-models";

const copilotLimiter = createRateLimiter({ limit: 60, windowMs: 60_000 });

function guard(req: Request): Response | null {
  if (!checkOrigin(req.headers.get("origin"), req.headers.get("host"))) return Response.json({ error: "forbidden origin" }, { status: 403 });
  const rl = copilotLimiter(clientKey(req));
  if (!rl.ok) return Response.json({ error: "rate limited" }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });
  return null;
}

// Server-only route. The key is read from the server environment and never
// leaves the server. The brain is Muse Spark via the Meta Model API
// (OpenAI-compatible surface, baseURL api.meta.ai). The runtime and its
// agents are constructed per request, after the key check, so importing
// this route never throws in a keyless dev boot.
//
// v2 SDK: CopilotRuntime holds BuiltInAgents built on an AI SDK language
// model (createOpenAI pointed at api.meta.ai, the same Responses-API
// callable form the old OpenAIAdapter.getLanguageModel() produced), and
// createCopilotRuntimeHandler serves the multi-route protocol (including
// GET /info agent discovery) under the /api/copilotkit base path.
function buildHandler(isVoiceTurn = false) {
  const apiKey = process.env.META_API_KEY;
  if (!apiKey) return null;
  const debugWire = process.env.DEBUG_META_WIRE === "1";
  const wireFetch: typeof fetch = async (url, init) => {
    if (debugWire) {
      try {
        const parsedBody = init?.body && typeof init.body === "string" ? JSON.parse(init.body) : null;
        console.log("[META WIRE INSPECT]", JSON.stringify({
          url: String(url),
          method: init?.method,
          isVoiceTurn,
          reasoning_effort: parsedBody?.reasoning_effort,
          reasoning: parsedBody?.reasoning,
          model: parsedBody?.model,
          hasTools: Boolean(parsedBody?.tools?.length),
          bodyKeys: parsedBody ? Object.keys(parsedBody) : [],
        }, null, 2));
      } catch (e) {
        console.log("[META WIRE INSPECT ERROR]", e);
      }
    }
    return fetch(url, init);
  };
  const model = createOpenAI({
    baseURL: "https://api.meta.ai/v1",
    apiKey,
    fetch: wireFetch,
  })(BRAIN_MODEL);

  // For voice turns only, configure reasoning effort to "low".
  // forceReasoning: true makes the AI SDK treat muse-spark-1.3 as a
  // reasoning model and transmit reasoning effort on the wire to Meta's
  // API instead of dropping it as an unsupported non-reasoning model.
  const agentConfig = {
    model,
    prompt: VVB_SYSTEM_PROMPT,
    ...(isVoiceTurn
      ? {
          providerOptions: {
            openai: {
              reasoningEffort: "low" as const,
              forceReasoning: true,
            },
          },
        }
      : {}),
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
    { error: "META_API_KEY is not configured on the server" },
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
