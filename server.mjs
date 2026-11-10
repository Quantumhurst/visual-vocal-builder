#!/usr/bin/env node
import { createServer } from "node:http";
import { parse } from "node:url";
import next from "next";
import { WebSocketServer } from "ws";
import { handleStreamClient } from "./lib/gemini-live-relay.ts";
import { checkOrigin } from "./lib/request-guard.ts";

process.env.WS_NO_BUFFER_UTIL = "true";

if (typeof process.loadEnvFile === "function") {
  try {
    process.loadEnvFile();
  } catch {
    // ignore if .env does not exist
  }
}

const dev = process.env.NODE_ENV !== "production";
const hostname = "localhost";
const port = Number(process.env.PORT || 3000);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

await app.prepare();

const server = createServer(async (req, res) => {
  try {
    const parsedUrl = parse(req.url || "", true);
    await handle(req, res, parsedUrl);
  } catch (err) {
    console.error("Error occurred handling", req.url, err);
    res.statusCode = 500;
    res.end("internal server error");
  }
});

const wss = new WebSocketServer({ noServer: true });

wss.on("connection", (clientWs) => {
  handleStreamClient(clientWs);
});

const nextUpgrade = app.getUpgradeHandler();

server.on("upgrade", (req, socket, head) => {
  const { pathname } = parse(req.url || "");
  if (pathname === "/api/asr-stream" || pathname === "/api/live-stream") {
    const origin = req.headers.origin;
    const host = req.headers.host;
    if (!checkOrigin(origin, host)) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  } else if (nextUpgrade) {
    nextUpgrade(req, socket, head);
  } else {
    socket.destroy();
  }
});

server.listen(port, () => {
  console.log(`> Visual Vocal Builder Unified Server ready on http://${hostname}:${port}`);
});
