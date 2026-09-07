import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/**
 * Resolves which Blocks project we are pointed at, with no flags required.
 *
 * The MCP server is spawned by an agent, so it cannot rely on being passed a
 * path: it inherits only a working directory. Resolution order:
 *   1. BLOCKS_CONSOLE_PROJECT (explicit override, used by the CLI)
 *   2. walk up from the start directory looking for aws-blocks/index.ts,
 *      the way git finds .git — so any subdirectory of a project works
 *   3. one level down, for monorepos where the agent sits at the repo root
 *      and the Blocks app lives in a subdirectory
 */

const MARKER = join("aws-blocks", "index.ts");
const MAX_WALK_UP = 8;
const CHILD_SCAN_LIMIT = 40;

export interface ResolvedProject {
  path: string;
  /** How it was found, so the agent can explain itself to a human */
  via: "env" | "cwd" | "ancestor" | "child";
  name: string;
}

export type ProjectResolution =
  | { ok: true; project: ResolvedProject }
  | { ok: false; reason: "not-found" | "ambiguous" | "bad-override"; candidates: string[] };

export function resolveProject(startDir: string = process.cwd()): ProjectResolution {
  const fromEnv = process.env.BLOCKS_CONSOLE_PROJECT;
  if (fromEnv) {
    const path = resolve(fromEnv);
    return isBlocksProject(path)
      ? { ok: true, project: describe(path, "env") }
      : { ok: false, reason: "bad-override", candidates: [] };
  }

  let dir = resolve(startDir);
  if (isBlocksProject(dir)) return { ok: true, project: describe(dir, "cwd") };

  for (let depth = 0; depth < MAX_WALK_UP; depth += 1) {
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
    if (isBlocksProject(dir)) return { ok: true, project: describe(dir, "ancestor") };
  }

  // A repo can legitimately hold several Blocks apps (an app plus a second
  // client), so report them instead of guessing which one was meant.
  const children = findChildProjects(resolve(startDir));
  if (children.length === 1 && children[0]) {
    return { ok: true, project: describe(children[0], "child") };
  }
  return {
    ok: false,
    reason: children.length > 1 ? "ambiguous" : "not-found",
    candidates: children,
  };
}

export function isBlocksProject(path: string): boolean {
  return existsSync(join(path, MARKER));
}

/** Shallow scan for child projects; all candidates are returned. */
function findChildProjects(root: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => !name.startsWith(".") && name !== "node_modules")
      .slice(0, CHILD_SCAN_LIMIT);
  } catch {
    return [];
  }
  return entries
    .map((name) => join(root, name))
    .filter((candidate) => isBlocksProject(candidate));
}

function describe(path: string, via: ResolvedProject["via"]): ResolvedProject {
  return { path, via, name: readPackageName(path) ?? path.split("/").pop() ?? path };
}

function readPackageName(path: string): string | null {
  const packagePath = join(path, "package.json");
  if (!existsSync(packagePath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(packagePath, "utf8"));
    return typeof parsed.name === "string" ? parsed.name : null;
  } catch {
    return null;
  }
}
