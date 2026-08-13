import { defineConfig } from "vite";

export default defineConfig({
  build: {
    target: "es2022",
    // Rapier ships its WebAssembly inlined as base64, which is convenient but
    // large. Keeping it and Three in their own chunks stops either from
    // blocking the first paint of the interface.
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes("@dimforge/rapier3d-compat")) return "rapier";
          if (id.includes("node_modules/three")) return "three";
          return undefined;
        },
      },
    },
  },
  server: {
    host: "127.0.0.1",
  },
});
