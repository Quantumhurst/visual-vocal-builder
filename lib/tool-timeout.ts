// Tool timeout — pure, unit-testable.
//
// A stalled tool must never leave the voice loop silently waiting. The
// shared wrapper races the tool against a fixed timeout; the Canvas turns
// a timeout into the visible RECOVERY banner and re-arms the mic.

export const TOOL_TIMEOUT_MS = 12_000;

export class ToolTimeoutError extends Error {
  readonly toolName: string;
  readonly timeoutMs: number;

  constructor(toolName: string, timeoutMs = TOOL_TIMEOUT_MS) {
    super(`Tool "${toolName}" timed out after ${timeoutMs}ms`);
    this.name = "ToolTimeoutError";
    this.toolName = toolName;
    this.timeoutMs = timeoutMs;
  }
}

export function withToolTimeout<T>(
  toolName: string,
  work: () => Promise<T> | T,
  timeoutMs = TOOL_TIMEOUT_MS,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new ToolTimeoutError(toolName, timeoutMs));
    }, Math.max(1, timeoutMs));

    Promise.resolve()
      .then(work)
      .then(
        (value) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(error);
        },
      );
  });
}

export function toolTimeoutLine(toolName: string, timeoutMs = TOOL_TIMEOUT_MS): string {
  return `The ${toolName} tool did not answer within ${Math.round(timeoutMs / 1000)}s. Nothing was changed.`;
}
