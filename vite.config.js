import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";

// /api/* routes are Vercel serverless functions in `api/meetings/*`. In a
// deployed Vercel environment these are same-origin. For local Vite dev,
// set VITE_API_PROXY_TARGET to a preview deploy URL to forward /api/* there
// (otherwise local /api/* requests will 404).
//
// /fireflies-api/* is a dev-only CORS workaround: it forwards to
// api.fireflies.ai (the Fireflies GraphQL endpoint). In production the client
// hits api.fireflies.ai directly (import.meta.env.DEV === false) — see
// src/lib/fireflies.js. The Bearer key is public-by-design, so this proxy is
// purely about CORS, not secrecy.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiProxyTarget = env.VITE_API_PROXY_TARGET || null;

  const proxy = {
    "/fireflies-api": {
      target: "https://api.fireflies.ai",
      changeOrigin: true,
      secure: true,
      rewrite: (path) => path.replace(/^\/fireflies-api/, ""),
    },
    ...(apiProxyTarget
      ? { "/api": { target: apiProxyTarget, changeOrigin: true, secure: true } }
      : {}),
  };

  return {
    plugins: [react()],
    // Yjs MUST be a single runtime instance. With multiple packages importing it
    // (@liveblocks/yjs, @tiptap/extension-collaboration, y-prosemirror, our own
    // import), Vite can otherwise bundle two copies — y-prosemirror's ops then run
    // against a Y.Doc from a different instance, instanceof checks fail silently,
    // and document edits never sync (presence still works — it rides Liveblocks
    // awareness, not Yjs internals). Deduping yjs fixes collaborative doc sync.
    resolve: {
      dedupe: ["yjs"],
    },
    server: {
      port: 5173,
      host: true,
      proxy,
    },
    test: {
      environment: "jsdom",
      globals: true,
      setupFiles: ["./src/setupTests.js"],
    },
  };
});
