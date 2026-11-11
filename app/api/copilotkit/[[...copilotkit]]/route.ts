import {
  BuiltInAgent,
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { checkOrigin, clientKey, createRateLimiter } from "../../../../lib/request-guard";
import { VVB_SYSTEM_PROMPT } from "../../../../lib/agent-prompt";
import { BRAIN_MODEL as GEMINI_BRAIN_MODEL, VOICE_TURN_THINKING_BUDGET } from "../../../../lib/gemini-models";
import { BRAIN_MODEL as META_BRAIN_MODEL } from "../../../../lib/meta-models";
import { resolveProvider, type VoiceProvider } from "../../../../lib/provider";

const copilotLimiter = createRateLimiter({ limit: 60, windowMs: 60_000 });

function guard(req: Request): Response | null {
  if (!checkOrigin(req.headers.get("origin"), req.headers.get("host"))) return Response.json({ error: "forbidden origin" }, { status: 403 });
  const rl = copilotLimiter(clientKey(req));
  if (!rl.ok) return Response.json({ error: "rate limited" }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });
  return null;
}

// The brain for the selected provider (lib/provider.ts):
// - gemini: Gemini Flash via the Google Generative AI API.
// - meta:   Muse Spark via the Meta Model API (OpenAI-compatible surface,
//           baseURL api.meta.ai). Voice turns run at low reasoning effort;
//           forceReasoning makes the AI SDK send that effort on the wire
//           instead of dropping it for a model it does not know reasons.
function agentConfigFor(provider: VoiceProvider, apiKey: string, isVoiceTurn: boolean) {
  if (provider === "meta") {
    const model = createOpenAI({ baseURL: "https://api.meta.ai/v1", apiKey })(META_BRAIN_MODEL);
    return {
      model,
      prompt: VVB_SYSTEM_PROMPT,
      ...(isVoiceTurn
        ? { providerOptions: { openai: { reasoningEffort: "low" as const, forceReasoning: true } } }
        : {}),
    };
  }
  const model = createGoogleGenerativeAI({ apiKey })(GEMINI_BRAIN_MODEL);
  return {
    model,
    prompt: VVB_SYSTEM_PROMPT,
    ...(isVoiceTurn
      ? { providerOptions: { google: { thinkingConfig: { thinkingBudget: VOICE_TURN_THINKING_BUDGET } } } }
      : {}),
  };
}

// Server-only route. The key is read from the server environment and never
// leaves the server. The runtime and its agents are constructed per
// request, after the key check, so importing this route never throws in a
// keyless dev boot.
function buildHandler(isVoiceTurn = false) {
  const resolved = resolveProvider();
  if (!resolved.ok) return { error: resolved.error };

  const agentConfig = agentConfigFor(resolved.provider, resolved.apiKey, isVoiceTurn);

  // Register the agent the UI binds to (useAgent agentId "vvb") alongside
  // "default" (the provider default). Both share the same model
  // construction and prompt.
  const runtime = new CopilotRuntime({
    agents: {
      default: new BuiltInAgent(agentConfig),
      vvb: new BuiltInAgent(agentConfig),
    },
  });
  return { handle: createCopilotRuntimeHandler({ runtime, basePath: "/api/copilotkit" }) };
}

async function serve(req: Request, isVoiceTurn: boolean) {
  const blocked = guard(req);
  if (blocked) return blocked;
  const built = buildHandler(isVoiceTurn);
  if (!built.handle) return Response.json({ error: built.error }, { status: 500 });
  return built.handle(req);
}

export async function POST(req: Request) {
  return serve(req, req.headers.get("x-voice-turn") === "1");
}

// Agent discovery (GET /api/copilotkit/info) and every other subpath of
// this catch-all segment are served by the same multi-route handler.
export async function GET(req: Request) {
  return serve(req, false);
}
