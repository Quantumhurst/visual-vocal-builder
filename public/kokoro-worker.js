/* Kokoro-82M neural TTS in a Web Worker (Apache-2.0 weights).
   Loaded as a module worker; the kokoro-js bundle comes from the CDN
   +esm build so Next's bundler never has to resolve its Node deps.
   The model itself downloads from Hugging Face on first use (~92 MB
   q8) and is cached by the browser. Any failure posts {type:"error"}
   and the page permanently falls back to the curated native voice. */
let tts = null;
let loading = null;

async function init() {
  if (tts) return tts;
  if (!loading) {
    loading = (async () => {
      const { KokoroTTS } = await import("https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/+esm");
      const model = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", {
        dtype: "q8",
        device: "wasm",
      });
      tts = model;
      return model;
    })();
  }
  return loading;
}

self.onmessage = async (event) => {
  const msg = event.data ?? {};
  if (msg.type === "init") {
    try {
      await init();
      self.postMessage({ type: "ready" });
    } catch (err) {
      self.postMessage({ type: "error", error: String(err && err.message ? err.message : err) });
    }
    return;
  }
  if (msg.type === "speak") {
    try {
      const model = await init();
      const stream = await model.stream(msg.text, { voice: msg.voice || "af_heart", speed: 1 });
      for await (const part of stream) {
        if (!part || !part.audio) continue;
        const wav = part.audio.toWav();
        const buf = wav instanceof ArrayBuffer ? wav : wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength);
        self.postMessage({ type: "audio", id: msg.id, buffer: buf }, [buf]);
      }
      self.postMessage({ type: "done", id: msg.id });
    } catch (err) {
      self.postMessage({ type: "speak-error", id: msg.id, error: String(err && err.message ? err.message : err) });
    }
  }
};
