import { defineConfig } from "tsup";

export default defineConfig({
  entry: { mcp: "src/mcp.ts" },
  format: ["esm"],
  target: "node22",
  platform: "node",
  outDir: "dist",
  clean: true,
  // The shared core is private and never published, so it must be compiled INTO
  // this bundle. Everything else stays external and resolves from node_modules.
  noExternal: ["@aws-blocks-devtools/core"],
  dts: false,
  sourcemap: true,
});
