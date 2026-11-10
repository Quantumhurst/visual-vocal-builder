// Gemini audio transcription fallback for buffered PCM audio.

export interface TranscribePcmOptions {
  model?: string;
  timeoutMs?: number;
}

export function pcmToWav(pcm: Buffer, sampleRate = 16000): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM format
  header.writeUInt16LE(1, 22); // Mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32); // Block align
  header.writeUInt16LE(16, 34); // Bits per sample
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export function isBufferSilent(pcm: Buffer, threshold = 0.003): boolean {
  if (pcm.length < 2) return true;
  let sumSq = 0;
  const count = Math.floor(pcm.length / 2);
  for (let i = 0; i < count * 2; i += 2) {
    const val = pcm.readInt16LE(i) / 32768.0;
    sumSq += val * val;
  }
  const rms = Math.sqrt(sumSq / (count || 1));
  return rms < threshold;
}

export async function transcribePcm(
  pcm: Buffer,
  apiKey: string,
  options: TranscribePcmOptions = {},
): Promise<string> {
  if (isBufferSilent(pcm)) {
    return "";
  }

  const model = options.model ?? "gemini-2.5-flash";
  const timeoutMs = options.timeoutMs ?? 15_000;
  const wav = pcmToWav(pcm);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: "Transcribe the spoken English in this audio recording verbatim. Output ONLY the transcribed words, without any commentary, preamble, or quotes. If there is no audible speech or only noise, output an empty string.",
              },
              {
                inlineData: {
                  mimeType: "audio/wav",
                  data: wav.toString("base64"),
                },
              },
            ],
          },
        ],
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Gemini ASR HTTP ${res.status}: ${errBody}`);
    }

    const data = (await res.json()) as {
      candidates?: Array<{
        content?: {
          parts?: Array<{ text?: string }>;
        };
      }>;
    };

    let text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
    text = text.replace(/^["'\s]+|["'\s]+$/g, "").trim();
    return text;
  } finally {
    clearTimeout(timer);
  }
}
