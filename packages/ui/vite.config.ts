import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 5173,
    // COOP/COEP not required for Asyncify (single-threaded), but harmless headers
    // keep us ready for a future threaded/SharedArrayBuffer build.
    fs: { allow: [".."] },
  },
  // nethack.js in public/core is loaded via a raw dynamic import; keep Vite from
  // trying to pre-bundle the 6 MB emscripten glue.
  optimizeDeps: { exclude: ["nethack"] },
});
