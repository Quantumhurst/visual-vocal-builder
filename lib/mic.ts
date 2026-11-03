// Microphone plumbing — the pieces that can be tested without a DOM.
//
// The PCM worklet is a static asset. A dev-server restart, an HMR reload,
// or a flaky first paint can make audioWorklet.addModule() fail with a
// transient "Network error" even though the file is served correctly a
// second later. One short retry turns that into a recording instead of a
// dead conversation. The failure text is shared so the UI never shows a
// raw stack or a misleading "microphone denied".

export const PCM_WORKLET_URL = "/pcm-capture-worklet.js";
export const WORKLET_RETRY_MS = 500;

export type AddModule = (url: string) => Promise<void>;
export type Wait = (ms: number) => Promise<void>;

export type LoadWorkletOptions = {
  url?: string;
  retryDelayMs?: number;
  wait?: Wait;
};

// Loads the worklet once, retries exactly once after a short pause, and
// rethrows the FIRST error if both attempts fail (so the displayed
// message describes the original cause, not the retry).
export async function loadPcmWorklet(
  addModule: AddModule,
  options: LoadWorkletOptions = {},
): Promise<{ attempts: number }> {
  const url = options.url ?? PCM_WORKLET_URL;
  const retryDelayMs = options.retryDelayMs ?? WORKLET_RETRY_MS;
  const wait =
    options.wait ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  try {
    await addModule(url);
    return { attempts: 1 };
  } catch (first) {
    await wait(retryDelayMs);
    // A failed AudioWorklet module URL stays rejected in the worklet
    // module map; asking for the same URL again can fail without ever
    // touching the network. A distinct query string forces a fresh load.
    const retryUrl = url.includes("?") ? `${url}&retry=1` : `${url}?retry=1`;
    try {
      await addModule(retryUrl);
      return { attempts: 2 };
    } catch {
      throw first;
    }
  }
}

// Plain-language mic failure text. Permission is a distinct problem from
// an asset/network failure, and both are distinct from a generic device
// error; saying "microphone access was not granted" for a worklet 404 is
// how users end up checking the wrong setting.
export function micFailureNotice(error: unknown): string {
  const name = error instanceof Error ? error.name : "";
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";

  if (name === "NotAllowedError" || /permission|denied|not allowed/i.test(message)) {
    return "Microphone access was not granted. Allow the mic or type a command.";
  }
  if (/worklet|module script|network|failed to fetch|load failed/i.test(message)) {
    return "The audio engine could not load. Refresh the page and press TALK again — or type a command.";
  }
  return `Microphone capture failed${message ? `: ${message}` : ""}. Type a command instead.`;
}
