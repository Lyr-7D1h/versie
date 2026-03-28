import { defineConfig } from "vite";
import { resolve } from "path";
import dts from "vite-plugin-dts";

export default defineConfig({
  plugins: [dts({ rollupTypes: true })],
  build: {
    lib: {
      entry: resolve(__dirname, "src/index.ts"),
      name: "versie",
      formats: ["es", "cjs"],
      fileName: (format) => `versie.${format === "es" ? "mjs" : "cjs"}`,
    },
    rollupOptions: {
      external: ["fast-diff", "lru-cache", "pako", "typescript-result", "zod"],
    },
    sourcemap: true,
  },
});
