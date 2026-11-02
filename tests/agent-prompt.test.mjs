import { test } from "node:test";
import assert from "node:assert/strict";
import { AGENT_ACTIONS } from "../lib/agent-actions.ts";
import { VVB_SYSTEM_PROMPT } from "../lib/agent-prompt.ts";

test("prompt mentions every AGENT_ACTIONS name", () => {
  for (const name of Object.values(AGENT_ACTIONS)) assert.ok(VVB_SYSTEM_PROMPT.includes(name), name);
});
test("prompt has never-invent rule and no-file/no-email rule", () => {
  assert.match(VVB_SYSTEM_PROMPT, /never-invent/i);
  assert.match(VVB_SYSTEM_PROMPT, /Never state legal, tax, or fee facts in prose/);
  assert.match(VVB_SYSTEM_PROMPT, /Never claim anything was filed or emailed/);
  assert.match(VVB_SYSTEM_PROMPT, /Nothing changed/);
  assert.match(VVB_SYSTEM_PROMPT, /Galactic Bagels/);
});
