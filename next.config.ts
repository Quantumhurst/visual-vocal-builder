import type { NextConfig } from "next";

// The Meta realtime STT client (ws) must stay a real Node package.
// Webpack used to inline an empty bufferutil stub into the route, so the
// first masked handshake frame threw "b.mask is not a function" and Meta
// closed the socket 10s later with "Handshake timeout". Keep ws external
// and force its pure-JS masking path.
process.env.WS_NO_BUFFER_UTIL = "true";

const nextConfig: NextConfig = {
  serverExternalPackages: ["ws", "bufferutil", "utf-8-validate"],
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
