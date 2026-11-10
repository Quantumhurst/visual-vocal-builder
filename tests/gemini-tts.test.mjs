import test from "node:test";
import assert from "node:assert/strict";

test("gemini-tts: origin security guard", async () => {
  const { POST } = await import("../app/api/tts/route.ts");
  const req = new Request("http://localhost:3000/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://malicious-site.com", Host: "localhost:3000" },
    body: JSON.stringify({ text: "Hello" }),
  });
  const res = await POST(req);
  assert.equal(res.status, 403);
});

test("gemini-tts: missing text validation", async () => {
  const { POST } = await import("../app/api/tts/route.ts");
  const req = new Request("http://localhost:3000/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://localhost:3000", Host: "localhost:3000" },
    body: JSON.stringify({ text: "" }),
  });
  const res = await POST(req);
  assert.equal(res.status, 400);
});

test("gemini-tts: missing API key handling", async () => {
  const savedKey = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    const { POST } = await import("../app/api/tts/route.ts");
    const req = new Request("http://localhost:3000/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://localhost:3000", Host: "localhost:3000" },
      body: JSON.stringify({ text: "Hello" }),
    });
    const res = await POST(req);
    assert.equal(res.status, 500);
  } finally {
    process.env.GEMINI_API_KEY = savedKey;
  }
});
