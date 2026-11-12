import { checkOrigin } from "../../../lib/request-guard.ts";
import { resolveProvider } from "../../../lib/provider.ts";
import { MAX_FAKE_TRANSCRIPT_CHARS, clearExpectedTranscript, expectTranscript } from "../../../lib/fake-provider.ts";

// Offline test mode only (VOICE_PROVIDER=fake): the headset walk posts the
// words of the clip it is about to play, so /api/transcribe can return
// them. Every other mode answers 404, as if the route did not exist.
function fakeMode(): boolean {
  const resolved = resolveProvider();
  return resolved.ok && resolved.provider === "fake";
}

export async function POST(req: Request) {
  if (!fakeMode()) return new Response(null, { status: 404 });
  if (!checkOrigin(req.headers.get("origin"), req.headers.get("host"), { requireOrigin: true })) {
    return Response.json({ error: "forbidden origin" }, { status: 403 });
  }
  let body: { text?: unknown };
  try {
    body = (await req.json()) as { text?: unknown };
  } catch {
    return Response.json({ error: "invalid json body" }, { status: 400 });
  }
  if (typeof body.text !== "string" || !body.text.trim()) {
    return Response.json({ error: "missing text" }, { status: 400 });
  }
  if (body.text.length > MAX_FAKE_TRANSCRIPT_CHARS) return Response.json({ error: "text too long" }, { status: 413 });
  expectTranscript(body.text);
  return Response.json({ ok: true });
}

export async function DELETE(req: Request) {
  if (!fakeMode()) return new Response(null, { status: 404 });
  if (!checkOrigin(req.headers.get("origin"), req.headers.get("host"), { requireOrigin: true })) {
    return Response.json({ error: "forbidden origin" }, { status: 403 });
  }
  clearExpectedTranscript();
  return Response.json({ ok: true });
}
