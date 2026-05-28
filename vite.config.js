import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";

// /api/* routes are Vercel serverless functions in `api/meetings/*`. In a
// deployed Vercel environment these are same-origin. For local Vite dev,
// set VITE_API_PROXY_TARGET to a preview deploy URL to forward /api/* there
// (otherwise local /api/* requests will 404).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiProxyTarget = env.VITE_API_PROXY_TARGET || null;

  return {
    plugins: [react()],
    server: {
      port: 5173,
      host: true,
      proxy: apiProxyTarget
        ? { "/api": { target: apiProxyTarget, changeOrigin: true, secure: true } }
        : undefined,
    },
    test: {
      environment: "jsdom",
      globals: true,
      setupFiles: ["./src/setupTests.js"],
    },
  };
});
