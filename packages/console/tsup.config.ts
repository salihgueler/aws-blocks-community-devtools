import { defineConfig } from "tsup";

export default defineConfig({
  entry: { cli: "server/cli.ts", main: "server/main.ts" },
  format: ["esm"],
  target: "node22",
  platform: "node",
  outDir: "dist-server",
  clean: true,
  // Same reason as the mcp package: the shared core is private, so it is
  // compiled in rather than declared as a runtime dependency.
  noExternal: ["@aws-blocks-devtools/core"],
  dts: false,
  sourcemap: true,
});
