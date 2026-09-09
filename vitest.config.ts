import { defineConfig } from "vitest/config";

// Minimal config: the suite is plain Node-side unit tests over the transport-free
// core. ES2022 + bundler resolution already come from tsconfig.base.json, which
// Vite/esbuild honours for the .ts test files, so nothing extra is needed here.
export default defineConfig({
  test: {
    environment: "node",
    include: ["packages/*/src/**/*.test.ts"],
  },
});
