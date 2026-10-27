import {
  CopilotRuntime,
  OpenAIAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
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
export async function POST(req: Request) {
  const apiKey = process.env.META_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "META_API_KEY is not configured on the server" },
      { status: 500 },
    );
  }
  const serviceAdapter = new OpenAIAdapter({
    openai: new OpenAI({
      baseURL: "https://api.meta.ai/v1",
      apiKey,
    }),
    model: "muse-spark-1.3",
  });
  const runtime = new CopilotRuntime();
  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime,
    serviceAdapter,
    endpoint: "/api/copilotkit",
  });
  return handleRequest(req);
}
