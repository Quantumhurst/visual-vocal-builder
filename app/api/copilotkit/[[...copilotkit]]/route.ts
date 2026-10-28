import {
  CopilotRuntime,
  OpenAIAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { BuiltInAgent } from "@copilotkit/runtime/v2";
import OpenAI from "openai";

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
function buildHandler() {
  const apiKey = process.env.META_API_KEY;
  if (!apiKey) return null;
  const serviceAdapter = new OpenAIAdapter({
    openai: new OpenAI({
      baseURL: "https://api.meta.ai/v1",
      apiKey,
    }),
    model: "muse-spark-1.3",
  });
  // Register the agent the UI binds to (useCoAgent name "vvb") alongside
  // "default" (useCopilotChat's implicit agent). Both use the same model
  // construction the runtime itself uses for its auto-created default.
  const runtime = new CopilotRuntime({
    agents: {
      default: new BuiltInAgent({ model: serviceAdapter.getLanguageModel() }),
      vvb: new BuiltInAgent({ model: serviceAdapter.getLanguageModel() }),
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
  const handleRequest = buildHandler();
  if (!handleRequest) return KEY_MISSING();
  return handleRequest(req);
}

// The 1.81 client probes GET /api/copilotkit/info for agent discovery.
// This catch-all segment forwards that probe (and every other subpath)
// to the same runtime handler; the runtime answers discovery via its
// single-route POST envelope, which the client falls back to on non-2xx.
export async function GET(req: Request) {
  const handleRequest = buildHandler();
  if (!handleRequest) return KEY_MISSING();
  return handleRequest(req);
}
