import { createOpenAI } from "@ai-sdk/openai";
import { BuiltInAgent } from "@copilotkit/runtime/v2";
import { OpenAIAdapter } from "@copilotkit/runtime";
import OpenAI from "openai";
import { VVB_SYSTEM_PROMPT } from "../lib/agent-prompt.ts";
import { AGENT_ACTIONS } from "../lib/agent-actions.ts";
import { S85_PACK, FILING_STEPS_PACK } from "../lib/knowledge.ts";
import { DEMO_JURISDICTIONS } from "../lib/demo-data.ts";
import { z } from "zod";
import fs from "node:fs";

// Load .env
if (typeof process.loadEnvFile === "function") {
  try {
    process.loadEnvFile();
  } catch {}
}

const apiKey = process.env.META_API_KEY;
if (!apiKey) {
  console.error("META_API_KEY missing");
  process.exit(1);
}

// Tool definitions matching Canvas.tsx
const toolDefinitions = [
  {
    name: AGENT_ACTIONS.showJurisdictionComparison,
    description: "Show the fictional jurisdiction comparison table and optionally select one of the fictional places (Mars, Europa, Andromeda Galaxy). Call this when the user asks to compare jurisdictions, choose a place to incorporate, or start incorporating the fictional company.",
    parameters: z.object({
      selectedJurisdiction: z.string().optional().describe("One of: Mars, Europa, Andromeda Galaxy"),
    }),
  },
  {
    name: AGENT_ACTIONS.setFounderEquity,
    description: "Set one DEMO owner's equity percent (e.g. the user says 'make me 70%'). The other owner(s) auto-adjust so the split always totals 100%. Owners are the readable founders list; there may be 1–5.",
    parameters: z.object({
      founder: z.string().describe("Owner name or 1-based index ('1', 'Orbit', etc.)"),
      percent: z.number().describe("Integer percent between 0 and 100"),
    }),
  },
  {
    name: AGENT_ACTIONS.showRolloverFact,
    description: "Show a grounded s.85 rollover fact card. Call with a factId from the readable s85Facts index when the user asks a rollover / section 85 question. Never invent rollover content; only pack facts become cards.",
    parameters: z.object({
      factId: z.string().describe("The fact ID to display from s85Facts (e.g. 'rollover-definition', 'rollover-shares-only', etc.)"),
    }),
  },
  {
    name: AGENT_ACTIONS.prepareLawyerSummary,
    description: "Prepare the lawyer-summary package (jurisdiction choice, equity split, checklist state) and display it on the canvas. Use when the user asks to prepare, show, or send-to-lawyer the summary. This only prepares the package for the user to forward; it never sends email.",
    parameters: z.object({}),
  },
];

const readableContext = JSON.stringify({
  company: "Galactic Bagels Inc. (fictional)",
  places: DEMO_JURISDICTIONS.map((j) => j.jurisdiction),
  jurisdictionRows: DEMO_JURISDICTIONS,
  selectedJurisdiction: null,
  founders: [{ name: "Alex", percent: 60 }, { name: "Orbit", percent: 40 }],
  checklist: [
    { id: "check-name", label: "Approve company name", done: false },
    { id: "check-jurisdiction", label: "Pick jurisdiction", done: false },
    { id: "check-equity", label: "Set equity split", done: false },
    { id: "check-filing", label: "Review filing steps", done: false },
    { id: "check-summary", label: "Prepare summary package", done: false },
  ],
  s85PackId: S85_PACK.packId,
  s85Facts: S85_PACK.facts.map((fact) => ({ factId: fact.factId, topic: fact.topic })),
  filingStepsPackId: FILING_STEPS_PACK.packId,
  filingStepsFacts: FILING_STEPS_PACK.facts.map((fact) => ({ factId: fact.factId, topic: fact.topic })),
  note: "Demo only. Facts come only from tools.",
});

const turns = [
  { id: "mars", label: "Mars", prompt: "Pick Mars as our home base", expectedTool: AGENT_ACTIONS.showJurisdictionComparison },
  { id: "equity", label: "Equity Change", prompt: "Make Orbit 70%", expectedTool: AGENT_ACTIONS.setFounderEquity },
  { id: "yes", label: "Yes", prompt: "Confirm", expectedTool: null },
  { id: "s85", label: "s.85 Grounded Card", prompt: "What is a section 85 rollover?", expectedTool: AGENT_ACTIONS.showRolloverFact },
  { id: "lawyer", label: "Lawyer Summary", prompt: "Prepare the lawyer summary", expectedTool: AGENT_ACTIONS.prepareLawyerSummary },
];

async function runTurnWithConfig(configName, agentConfigFactory, turnPrompt) {
  let interceptedWire = null;
  const wireFetch = async (url, init) => {
    try {
      interceptedWire = {
        url: String(url),
        method: init?.method,
        body: init?.body ? JSON.parse(init.body) : null,
      };
    } catch {}
    return fetch(url, init);
  };

  const agent = agentConfigFactory(wireFetch);

  const start = Date.now();
  let firstDeltaMs = null;
  let text = "";
  let toolCalls = [];

  const stream = await agent.run({
    messages: [
      { role: "system", content: `Current state context:\n${readableContext}` },
      { role: "user", content: turnPrompt },
    ],
    tools: toolDefinitions.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    })),
  });

  await new Promise((resolve, reject) => {
    stream.subscribe({
      next: (event) => {
        const now = Date.now() - start;
        if (event.type === "TEXT_MESSAGE_CHUNK") {
          if (firstDeltaMs === null) firstDeltaMs = now;
          text += event.delta || event.content || "";
        } else if (event.type === "TOOL_CALL_START") {
          if (firstDeltaMs === null) firstDeltaMs = now;
          toolCalls.push({
            toolCallId: event.toolCallId,
            name: event.toolCallName || event.toolName,
            args: "",
          });
        } else if (event.type === "TOOL_CALL_ARGS") {
          const tc = toolCalls.find((c) => c.toolCallId === event.toolCallId);
          if (tc && event.delta) tc.args += event.delta;
        }
      },
      error: reject,
      complete: resolve,
    });
  });

  const totalMs = Date.now() - start;

  for (const tc of toolCalls) {
    try {
      tc.parsedArgs = JSON.parse(tc.args);
    } catch {
      tc.parsedArgs = tc.args;
    }
  }

  return {
    configName,
    prompt: turnPrompt,
    firstDeltaMs: firstDeltaMs ?? totalMs,
    totalMs,
    toolCalls,
    text: text.trim(),
    wire: {
      url: interceptedWire?.url,
      method: interceptedWire?.method,
      reasoning_effort: interceptedWire?.body?.reasoning_effort,
      reasoning: interceptedWire?.body?.reasoning,
      bodyKeys: interceptedWire?.body ? Object.keys(interceptedWire.body) : [],
    },
  };
}

// Baseline: OpenAIAdapter with default model (no reasoning knob)
function makeBaselineAgent(wireFetch) {
  const serviceAdapter = new OpenAIAdapter({
    openai: new OpenAI({
      baseURL: "https://api.meta.ai/v1",
      apiKey,
      fetch: wireFetch,
    }),
    model: "muse-spark-1.3",
  });
  return new BuiltInAgent({
    model: serviceAdapter.getLanguageModel(),
    prompt: VVB_SYSTEM_PROMPT,
  });
}

// Experiment: Responses API with forceReasoning and reasoningEffort: "low"
function makeLowResponsesAgent(wireFetch) {
  const serviceAdapter = new OpenAIAdapter({
    openai: new OpenAI({
      baseURL: "https://api.meta.ai/v1",
      apiKey,
      fetch: wireFetch,
    }),
    model: "muse-spark-1.3",
  });
  return new BuiltInAgent({
    model: serviceAdapter.getLanguageModel(),
    prompt: VVB_SYSTEM_PROMPT,
    providerOptions: {
      openai: {
        reasoningEffort: "low",
        forceReasoning: true,
      },
    },
  });
}

// Experiment: Chat Completions API with reasoning_effort: "low"
function makeLowChatAgent(wireFetch) {
  const openaiAiSdk = createOpenAI({
    baseURL: "https://api.meta.ai/v1",
    apiKey,
    fetch: wireFetch,
  });
  return new BuiltInAgent({
    model: openaiAiSdk.chat("muse-spark-1.3"),
    prompt: VVB_SYSTEM_PROMPT,
    providerOptions: {
      openai: {
        reasoningEffort: "low",
      },
    },
  });
}

async function main() {
  console.log("===============================================================================");
  console.log("   A/B BENCHMARK: CURRENT BASELINE vs LOW REASONING EFFORT (MUSE-SPARK-1.3)");
  console.log("===============================================================================\n");

  const results = {
    baseline: [],
    lowResponses: [],
    lowChat: [],
  };

  for (const turn of turns) {
    console.log(`\n-------------------------------------------------------------------------------`);
    console.log(`Turn [${turn.label}]: "${turn.prompt}" (Expected Tool: ${turn.expectedTool ?? "None/Text"})`);
    console.log(`-------------------------------------------------------------------------------`);

    // 1. Baseline
    console.log(`  [BASELINE (Current)]:`);
    const resBase = await runTurnWithConfig("baseline", makeBaselineAgent, turn.prompt);
    results.baseline.push(resBase);
    console.log(`    Total: ${resBase.totalMs}ms | First Delta: ${resBase.firstDeltaMs}ms`);
    console.log(`    Wire URL: ${resBase.wire.url}`);
    console.log(`    Wire reasoning: ${JSON.stringify(resBase.wire.reasoning)} | reasoning_effort: ${resBase.wire.reasoning_effort}`);
    console.log(`    Tool calls: ${resBase.toolCalls.map((t) => `${t.name}(${JSON.stringify(t.parsedArgs)})`).join(", ") || "(none)"}`);
    console.log(`    Host line: "${resBase.text.slice(0, 90).replace(/\n/g, " ")}"`);

    // 2. Low Responses (forceReasoning: true)
    console.log(`\n  [LOW (Responses API + forceReasoning)]:`);
    const resLowResp = await runTurnWithConfig("low-responses", makeLowResponsesAgent, turn.prompt);
    results.lowResponses.push(resLowResp);
    console.log(`    Total: ${resLowResp.totalMs}ms | First Delta: ${resLowResp.firstDeltaMs}ms`);
    console.log(`    Wire URL: ${resLowResp.wire.url}`);
    console.log(`    Wire reasoning: ${JSON.stringify(resLowResp.wire.reasoning)} | reasoning_effort: ${resLowResp.wire.reasoning_effort}`);
    console.log(`    Tool calls: ${resLowResp.toolCalls.map((t) => `${t.name}(${JSON.stringify(t.parsedArgs)})`).join(", ") || "(none)"}`);
    console.log(`    Host line: "${resLowResp.text.slice(0, 90).replace(/\n/g, " ")}"`);

    // 3. Low Chat (Chat Completions API)
    console.log(`\n  [LOW (Chat API + reasoning_effort: "low")]:`);
    const resLowChat = await runTurnWithConfig("low-chat", makeLowChatAgent, turn.prompt);
    results.lowChat.push(resLowChat);
    console.log(`    Total: ${resLowChat.totalMs}ms | First Delta: ${resLowChat.firstDeltaMs}ms`);
    console.log(`    Wire URL: ${resLowChat.wire.url}`);
    console.log(`    Wire reasoning: ${JSON.stringify(resLowChat.wire.reasoning)} | reasoning_effort: ${resLowChat.wire.reasoning_effort}`);
    console.log(`    Tool calls: ${resLowChat.toolCalls.map((t) => `${t.name}(${JSON.stringify(t.parsedArgs)})`).join(", ") || "(none)"}`);
    console.log(`    Host line: "${resLowChat.text.slice(0, 90).replace(/\n/g, " ")}"`);
  }

  // Summary Comparison Table
  console.log("\n\n==========================================================================================================");
  console.log("   A/B BENCHMARK SUMMARY TABLE: MEASURED TIMINGS (CURRENT vs LOW)");
  console.log("==========================================================================================================");
  console.log("Turn               | Baseline (Total / 1st) | Low Resp (Total / 1st) | Low Chat (Total / 1st) | Savings (Chat vs Base)");
  console.log("-------------------|------------------------|------------------------|------------------------|-----------------------");

  let totalBaseMs = 0;
  let totalLowRespMs = 0;
  let totalLowChatMs = 0;

  for (let i = 0; i < turns.length; i++) {
    const b = results.baseline[i];
    const lr = results.lowResponses[i];
    const lc = results.lowChat[i];

    totalBaseMs += b.totalMs;
    totalLowRespMs += lr.totalMs;
    totalLowChatMs += lc.totalMs;

    const diffMs = lc.totalMs - b.totalMs;
    const diffPct = ((diffMs / b.totalMs) * 100).toFixed(1);

    const pad = (s, len) => s.padEnd(len);
    console.log(
      `${pad(turns[i].label, 18)} | ` +
      `${pad(`${b.totalMs}ms / ${b.firstDeltaMs}ms`, 22)} | ` +
      `${pad(`${lr.totalMs}ms / ${lr.firstDeltaMs}ms`, 22)} | ` +
      `${pad(`${lc.totalMs}ms / ${lc.firstDeltaMs}ms`, 22)} | ` +
      `${diffMs}ms (${diffPct}%)`
    );
  }

  const overallDiffChat = totalLowChatMs - totalBaseMs;
  const overallPctChat = ((overallDiffChat / totalBaseMs) * 100).toFixed(1);
  const overallDiffResp = totalLowRespMs - totalBaseMs;
  const overallPctResp = ((overallDiffResp / totalBaseMs) * 100).toFixed(1);
  console.log("-------------------|------------------------|------------------------|------------------------|-----------------------");
  console.log(`OVERALL TOTAL      | ${totalBaseMs}ms             | ${totalLowRespMs}ms (${overallDiffResp}ms, ${overallPctResp}%) | ${totalLowChatMs}ms (${overallDiffChat}ms, ${overallPctChat}%) | ${overallDiffChat}ms (${overallPctChat}%)`);

  fs.mkdirSync("proof", { recursive: true });
  fs.writeFileSync("proof/ab-reasoning-benchmark.json", JSON.stringify(results, null, 2));
  console.log("\nFull results written to proof/ab-reasoning-benchmark.json");
}

main().catch(console.error);
