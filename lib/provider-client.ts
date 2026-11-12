// Browser side of the provider switch: ask the server once which engines
// it is configured for (lib/provider.ts) and remember the answer.

import { SAFE_PROVIDER_INFO, type ProviderInfo } from "./provider.ts";

let cached: ProviderInfo | null = null;
let pending: Promise<ProviderInfo> | null = null;

export function parseProviderInfo(data: unknown): ProviderInfo | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (d.provider !== "gemini" && d.provider !== "meta" && d.provider !== "fake") return null;
  return {
    provider: d.provider,
    streamingAsr: d.streamingAsr === true,
    neuralVoice: d.neuralVoice === true,
    label: typeof d.label === "string" ? d.label : "",
  };
}

// The answer if it has arrived, otherwise the safe default that works
// with either provider (buffered transcription, browser voice).
export function currentProviderInfo(): ProviderInfo {
  return cached ?? SAFE_PROVIDER_INFO;
}

type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

// Never rejects. A failed lookup is not remembered, so the next call retries.
export function loadProviderInfo(fetchImpl?: FetchLike): Promise<ProviderInfo> {
  if (cached) return Promise.resolve(cached);
  if (pending) return pending;
  const doFetch = fetchImpl ?? ((url, init) => fetch(url, init));
  pending = (async () => {
    try {
      const res = await doFetch("/api/provider", { signal: AbortSignal.timeout(4000) });
      const info = res.ok ? parseProviderInfo(await res.json()) : null;
      if (info) cached = info;
      return info ?? SAFE_PROVIDER_INFO;
    } catch {
      return SAFE_PROVIDER_INFO;
    } finally {
      pending = null;
    }
  })();
  return pending;
}

export function resetProviderInfoForTests() {
  cached = null;
  pending = null;
}
