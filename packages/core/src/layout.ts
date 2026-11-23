import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Where a project keeps its backend, config, sandbox state and local data.
 *
 * AWS CDK Blocks 1.0 renamed every one of these. A 1.0 app has `cdk-blocks/`,
 * `.cdk-blocks/`, `.cdk-blocks-sandbox/` and `.cdk-blocks/local/data/`; a 0.x
 * app has `aws-blocks/`, `.blocks/`, `.blocks-sandbox/` and `.bb-data/`. Both
 * layouts are supported, and the 1.0 name wins whenever it exists, because the
 * 1.0 runtime copies old state into the new place and leaves the old folder
 * behind, stale.
 */

export const BACKEND_DIRS = ["cdk-blocks", "aws-blocks"] as const;
export type BackendDir = (typeof BACKEND_DIRS)[number];

/** The backend folder holding `index.ts`, or null when neither exists. */
export function backendDirName(projectPath: string): BackendDir | null {
  return BACKEND_DIRS.find((dir) => existsSync(join(projectPath, dir, "index.ts"))) ?? null;
}

/** True for a project laid out for AWS CDK Blocks 1.0. */
export function isCdkBlocksLayout(projectPath: string): boolean {
  return backendDirName(projectPath) === "cdk-blocks";
}

function firstExisting(projectPath: string, current: string, legacy: string): string {
  if (existsSync(join(projectPath, current))) return current;
  if (existsSync(join(projectPath, legacy))) return legacy;
  return isCdkBlocksLayout(projectPath) ? current : legacy;
}

/** Relative path of the local mock state, e.g. `.cdk-blocks/local/data`. */
export function localDataDirName(projectPath: string): string {
  return firstExisting(projectPath, join(".cdk-blocks", "local", "data"), ".bb-data");
}

/** Relative path of the per-project config folder holding `config.json`. */
export function configDirName(projectPath: string): string {
  return firstExisting(projectPath, ".cdk-blocks", ".blocks");
}

/** Relative path of the per-deploy state folder. */
export function sandboxDirName(projectPath: string): string {
  return firstExisting(projectPath, ".cdk-blocks-sandbox", ".blocks-sandbox");
}

/**
 * The JSON-RPC path on the dev server. 1.0 serves `/cdk-blocks/api` and keeps
 * `/aws-blocks/api` as an alias; a 0.x server only knows `/aws-blocks/api`.
 */
export function apiPath(projectPath: string): string {
  return isCdkBlocksLayout(projectPath) ? "/cdk-blocks/api" : "/aws-blocks/api";
}

/**
 * The dev-server port a 1.0 app sets in `package.json#blocks.dev.port`, or
 * null when it sets none.
 */
export function packageDevPort(projectPath: string): number | null {
  const packagePath = join(projectPath, "package.json");
  if (!existsSync(packagePath)) return null;
  try {
    const parsed: unknown = JSON.parse(readFileSync(packagePath, "utf8"));
    const port = readPath(parsed, ["blocks", "dev", "port"]);
    return typeof port === "number" && Number.isInteger(port) && port > 0 && port < 65536
      ? port
      : null;
  } catch {
    return null;
  }
}

function readPath(value: unknown, keys: string[]): unknown {
  let current: unknown = value;
  for (const key of keys) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}
