import {
  CopilotRuntime,
  OpenAIAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { BuiltInAgent } from "@copilotkit/runtime/v2";
import OpenAI from "openai";
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
// leaves the server. CopilotKit is the frontend SDK; the brain is Muse Spark
// via the Meta Model API (OpenAI-compatible surface, baseURL api.meta.ai).
// The adapter and endpoint are constructed per request, after the key check,
// so importing this route never throws in a keyless dev boot.
//
// Note: the installed 1.81.0 default import path is the v1 SDK, marked
// deprecated since 1.68.2 in favor of v2. The v1 path is still shipped and
// typed in the pinned version, and it matches this brief's specified wiring
// (provider + useCoAgent + frontend actions). A v2 migration is a later
// decision, not Day 1 scope.
function buildHandler(isVoiceTurn = false) {
  const apiKey = process.env.META_API_KEY;
  if (!apiKey) return null;
  const wireFetch: typeof fetch = async (url, init) => {
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
    return fetch(url, init);
  };
  const serviceAdapter = new OpenAIAdapter({
    openai: new OpenAI({
      baseURL: "https://api.meta.ai/v1",
      apiKey,
      fetch: wireFetch,
    }),
    model: BRAIN_MODEL,
  });

  // For voice turns only, configure reasoning effort to "low".
  // Using forceReasoning: true ensures the AI SDK treats muse-spark-1.3 as a
  // reasoning model and transmits reasoning: { effort: "low" } on the wire to
  // Meta's Responses API instead of dropping it as an unsupported non-reasoning model.
  const agentConfig = {
    model: serviceAdapter.getLanguageModel(),
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
  // Register the agent the UI binds to (useCoAgent name "vvb") alongside
  // "default" (useCopilotChat's implicit agent). Both use the same model
  // construction the runtime itself uses for its auto-created default.
  const runtime = new CopilotRuntime({
    agents: {
      default: new BuiltInAgent(agentConfig),
      vvb: new BuiltInAgent(agentConfig),
    },
  });
  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime,
    serviceAdapter,
    endpoint: "/api/copilotkit",
  });
  return handleRequest;
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

// The 1.81 client probes GET /api/copilotkit/info for agent discovery.
// This catch-all segment forwards that probe (and every other subpath)
// to the same runtime handler; the runtime answers discovery via its
// single-route POST envelope, which the client falls back to on non-2xx.
export async function GET(req: Request) {
  const blocked = guard(req); if (blocked) return blocked;
  const handleRequest = buildHandler(false);
  if (!handleRequest) return KEY_MISSING();
  return handleRequest(req);
}
