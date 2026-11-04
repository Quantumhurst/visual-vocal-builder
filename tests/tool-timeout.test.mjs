import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TOOL_TIMEOUT_MS,
  ToolTimeoutError,
  toolTimeoutLine,
  withToolTimeout,
} from "../lib/tool-timeout.ts";

test("a fast tool resolves normally", async () => {
  const value = await withToolTimeout("fast", () => 42, 200);
  assert.equal(value, 42);
});

test("a stalled tool rejects with a typed timeout", async () => {
  await assert.rejects(
    withToolTimeout("stalled", () => new Promise(() => {}), 20),
    (error) => {
      assert.ok(error instanceof ToolTimeoutError);
      assert.equal(error.toolName, "stalled");
      assert.equal(error.timeoutMs, 20);
      assert.equal(error.name, "ToolTimeoutError");
      return true;
    },
  );
});

test("a thrown tool error is preserved", async () => {
  await assert.rejects(
    withToolTimeout("broken", () => {
      throw new Error("tool failed");
    }, 200),
    /tool failed/,
  );
});

test("the timeout line names the tool and says nothing changed", () => {
  const line = toolTimeoutLine("setFounderEquity");
  assert.match(line, /setFounderEquity/);
  assert.match(line, /Nothing was changed/);
  assert.ok(TOOL_TIMEOUT_MS >= 5_000);
  assert.match(line, /12s/);
});
