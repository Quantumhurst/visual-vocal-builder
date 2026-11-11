#!/usr/bin/env node
import { createServer } from "node:http";
import { parse } from "node:url";
import next from "next";
import { WebSocketServer } from "ws";
import { handleStreamClient } from "./lib/meta-stream-relay.ts";
import { providerInfo, resolveProvider } from "./lib/provider.ts";
import {
  checkOrigin,
  clientKey,
  createConnectionLimiter,
  isTrustProxy,
  normalizeForwardedHeaders,
} from "./lib/request-guard.ts";

process.env.WS_NO_BUFFER_UTIL = "true";

if (typeof process.loadEnvFile === "function") {
  try {
    process.loadEnvFile();
  } catch {
    // ignore if .env does not exist
  }
}

const dev = process.env.NODE_ENV !== "production";
// Bind address. localhost by default; set HOST=0.0.0.0 to serve a LAN or
// a container.
const hostname = process.env.HOST || "localhost";
const trustProxy = isTrustProxy();
// One mic stream per tab is normal; a few allows a reload overlapping the
// old socket's close. Each stream holds a billed upstream speech session.
const streamLimiter = createConnectionLimiter({ perKey: 3, total: 50 });
// Browser audio frames are ~100 ms of PCM16 (3.2 KB). Anything near this
// cap is not a microphone.
const MAX_WS_PAYLOAD = 64 * 1024;
const port = Number(process.env.PORT || 3000);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

await app.prepare();

const server = createServer(async (req, res) => {
  normalizeForwardedHeaders(req.headers, req.socket.remoteAddress, trustProxy);
  try {
    const parsedUrl = parse(req.url || "", true);
    await handle(req, res, parsedUrl);
  } catch (err) {
    console.error("Error occurred handling", req.url, err);
    res.statusCode = 500;
    res.end("internal server error");
  }
});

const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_WS_PAYLOAD });

wss.on("connection", (clientWs, _req, key) => {
  clientWs.once("close", () => streamLimiter.release(key));
  handleStreamClient(clientWs);
});

const nextUpgrade = app.getUpgradeHandler();

server.on("upgrade", (req, socket, head) => {
  normalizeForwardedHeaders(req.headers, req.socket.remoteAddress, trustProxy);
  const { pathname } = parse(req.url || "");
  if (pathname === "/api/asr-stream") {
    const origin = req.headers.origin;
    const host = req.headers.host;
    if (!checkOrigin(origin, host, { requireOrigin: true })) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }
    // Realtime streaming speech-to-text exists only for the Meta provider.
    // In Gemini mode the browser never opens this socket; refuse cleanly
    // if something does, so the client uses its buffered path.
    const resolved = resolveProvider();
    if (!resolved.ok || !providerInfo(resolved.provider).streamingAsr) {
      socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
      socket.destroy();
      return;
    }
    const key = clientKey(req);
    if (!streamLimiter.acquire(key)) {
      socket.write("HTTP/1.1 429 Too Many Requests\r\n\r\n");
      socket.destroy();
      return;
    }
    let upgraded = false;
    socket.once("close", () => {
      if (!upgraded) streamLimiter.release(key);
    });
    wss.handleUpgrade(req, socket, head, (ws) => {
      upgraded = true;
      wss.emit("connection", ws, req, key);
    });
  } else if (nextUpgrade) {
    nextUpgrade(req, socket, head);
  } else {
    socket.destroy();
  }
});

server.listen(port, () => {
  const resolved = resolveProvider();
  console.log(`> Visual Vocal Builder Unified Server ready on http://${hostname}:${port}`);
  console.log(
    resolved.ok
      ? `> Voice provider: ${providerInfo(resolved.provider).label} (${resolved.source === "explicit" ? "VOICE_PROVIDER" : "chosen from the key present"})`
      : `> Voice provider: not configured — ${resolved.error}`,
  );
});
