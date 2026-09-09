import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

/**
 * Baseline lint. The point of adding this is `react-hooks`: the console UI holds
 * the only stateful code in the repo, and a dependency-array mistake there is
 * invisible to `tsc`. Everything else here is the low-noise recommended set.
 *
 * Rules are referenced by name rather than by spreading the plugin's own config
 * export, because that export's shape has changed between plugin majors while
 * the rule ids have not.
 *
 * Deliberately NOT type-checked linting (`recommendedTypeChecked`): it needs a
 * parser project service and is markedly slower. `tsc --noEmit` already runs as
 * its own gate, so the overlap would buy little. Worth revisiting if a class of
 * bug starts slipping through both.
 */
export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/dist-server/**",
      "**/*.d.ts",
      // Authoring material for the published agent skill, not source we own the
      // style of.
      "skills/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // The React surface. These two rules are the reason this config exists.
    files: ["packages/console/src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  {
    // Plain ESM run directly by node (bin shims and repo scripts). These are
    // not TypeScript, so `no-undef` is live and needs the Node globals named.
    files: ["**/*.mjs"],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
        URL: "readonly",
        __dirname: "readonly",
      },
    },
  },
);
