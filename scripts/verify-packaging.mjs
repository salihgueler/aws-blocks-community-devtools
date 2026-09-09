#!/usr/bin/env node
/**
 * Packaging guard: the private core must be COMPILED INTO both published
 * packages and must never resolve as a dependency in a consumer's tree.
 *
 * `@aws-blocks-devtools/core` is `private: true` and unpublished. It reaches
 * users only because tsup inlines it via `noExternal`, and it is declared as a
 * devDependency so npm never tries to fetch it. Break either and `npm install`
 * fails for everyone with E404 on a package that does not exist. See
 * docs/adr/0001-core-is-compiled-in-not-a-dependency.md.
 *
 * This packs the real tarballs and installs them into a throwaway project, so
 * it tests what a user actually receives rather than what the workspace looks
 * like. Note the ordering below: asserting the core is ABSENT proves nothing
 * unless the install demonstrably happened first, so the positive checks run
 * before the negative one.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO = resolve(import.meta.dirname, "..");
const PRIVATE_SCOPE = "@aws-blocks-devtools";
const PACKAGES = ["aws-blocks-console", "aws-blocks-mcp"];

const failures = [];
const notes = [];

function run(cmd, args, cwd) {
  return execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function check(ok, message) {
  if (ok) notes.push(`  ok    ${message}`);
  else failures.push(`  FAIL  ${message}`);
  return ok;
}

const stage = mkdtempSync(join(tmpdir(), "blocks-pack-"));
const consumer = mkdtempSync(join(tmpdir(), "blocks-consumer-"));

// npm pack ships whatever is on disk; it does not build. Without this the run
// fails later with a confusing "ships its built CLI entry" instead of the real
// cause.
const builtOutputs = [
  ["packages/console/dist-server/cli.js", "aws-blocks-console"],
  ["packages/mcp/dist/mcp.js", "aws-blocks-mcp"],
];
const unbuilt = builtOutputs.filter(([relative]) => !existsSync(join(REPO, relative)));
if (unbuilt.length > 0) {
  console.error("build output missing — run `npm run build` first:");
  for (const [relative] of unbuilt) console.error(`  ${relative}`);
  process.exit(1);
}

console.log("packing workspaces…");
const tarballs = PACKAGES.map((name) => {
  const out = run("npm", ["pack", "--workspace", name, "--pack-destination", stage, "--json"], REPO);
  const filename = JSON.parse(out)[0]?.filename;
  if (!filename) throw new Error(`npm pack produced no filename for ${name}`);
  return join(stage, filename);
});

// A tarball that does not exist would make the install a no-op and every
// absence check below pass for the wrong reason.
for (const tarball of tarballs) {
  check(existsSync(tarball), `packed ${tarball.split("/").pop()}`);
}

console.log("installing tarballs into a clean consumer project…");
writeFileSync(
  join(consumer, "package.json"),
  JSON.stringify({ name: "packaging-guard-consumer", private: true, version: "0.0.0" }, null, 2),
);
try {
  run("npm", ["install", ...tarballs, "--no-audit", "--no-fund", "--loglevel=error"], consumer);
} catch (error) {
  // The most likely cause by far, and the one this guard exists to catch: the
  // private core was declared a real `dependency`, so npm tried to fetch a
  // package that was never published and 404'd. That is exactly what every
  // consumer's `npm install` would do.
  const detail = String(error instanceof Error ? error.message : error);
  console.error("");
  console.error("installing the packed tarballs FAILED — the published packages are not installable.");
  if (detail.includes("404")) {
    console.error(
      `\nnpm could not resolve a dependency. Check that ${PRIVATE_SCOPE}/core is still a\n` +
        "devDependency (never a dependency) in both packages, and that tsup still\n" +
        "inlines it via noExternal. See docs/adr/0001-core-is-compiled-in-not-a-dependency.md.",
    );
  }
  console.error(`\nnpm output:\n${detail}`);
  console.error(`\nconsumer project left for inspection: ${consumer}`);
  process.exit(1);
}

const modules = join(consumer, "node_modules");

// POSITIVE FIRST: prove the install really landed. If these fail, the negative
// check below is vacuous and the whole run is meaningless.
for (const name of PACKAGES) {
  check(existsSync(join(modules, name)), `${name} installed`);
}
check(
  existsSync(join(modules, "aws-blocks-console", "dist-server", "cli.js")),
  "aws-blocks-console ships its built CLI entry",
);
check(
  existsSync(join(modules, "aws-blocks-mcp", "dist", "mcp.js")),
  "aws-blocks-mcp ships its built server entry",
);

// NEGATIVE: the private core must be nowhere in the consumer's tree.
check(
  !existsSync(join(modules, PRIVATE_SCOPE)),
  `${PRIVATE_SCOPE} is absent from the consumer's node_modules`,
);

// Skill files are authoring material, not runtime payload — they must not ship.
for (const name of PACKAGES) {
  check(!existsSync(join(modules, name, "skills")), `${name} ships no skills/ directory`);
}

console.log("");
for (const line of notes) console.log(line);
for (const line of failures) console.log(line);
console.log("");

if (failures.length > 0) {
  console.error(`packaging guard FAILED (${failures.length} problem(s))`);
  console.error(`consumer project left for inspection: ${consumer}`);
  process.exit(1);
}
console.log(`packaging guard passed (${notes.length} checks)`);
