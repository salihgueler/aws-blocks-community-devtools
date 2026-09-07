import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

/**
 * Registers this MCP server in the agents installed on the machine.
 *
 * Rules this module holds to, because it edits files it does not own:
 * - merge, never replace: an existing config may hold many other servers
 * - back up before the first write to any file
 * - idempotent: re-running changes nothing once the entry matches
 * - read tools are auto-approved, writes never are
 */

export const SERVER_KEY = "aws-blocks-mcp";

/**
 * The key this server used before the packages were split. `connect` removes it
 * when it writes, because it points at a path that no longer exists — leaving it
 * behind means the agent keeps trying to spawn a missing file on every start.
 */
export const LEGACY_SERVER_KEYS = ["blocks-console"];

/** Read tools are safe to run unprompted; write tools are deliberately absent. */
const AUTO_APPROVE = ["blocks_project", "blocks_read", "blocks_rpc"];

export interface AgentTarget {
  id: string;
  label: string;
  configPath: string;
  format: "json" | "toml";
}

export type ConnectMode = "published" | "local";

export interface ConnectOutcome {
  target: AgentTarget;
  status: "written" | "unchanged" | "unsupported" | "failed";
  detail?: string;
  backupPath?: string;
}

export function knownTargets(home: string = homedir()): AgentTarget[] {
  return [
    { id: "kiro", label: "Kiro", configPath: join(home, ".kiro", "settings", "mcp.json"), format: "json" },
    { id: "cursor", label: "Cursor", configPath: join(home, ".cursor", "mcp.json"), format: "json" },
    { id: "claude-code", label: "Claude Code", configPath: join(home, ".claude.json"), format: "json" },
    { id: "codex", label: "Codex", configPath: join(home, ".codex", "config.toml"), format: "toml" },
  ];
}

/** Only agents whose config already exists — never create one for an agent that is not installed. */
export function detectTargets(home?: string): AgentTarget[] {
  return knownTargets(home).filter((target) => existsSync(target.configPath));
}

/**
 * `published` points at the aws-blocks-mcp npm package, whose bin IS the server —
 * note this registers a DIFFERENT package than the one running `connect`, which
 * is deliberate: an agent should not install a React UI it will never render.
 *
 * `local` points at this checkout's own tsx and the mcp package's dev entry, so
 * it works before anything is published and keeps following the working tree.
 */
export function serverEntry(mode: ConnectMode): Record<string, unknown> {
  if (mode === "published") {
    return { command: "npx", args: ["-y", "aws-blocks-mcp"], autoApprove: AUTO_APPROVE };
  }
  // server/ -> packages/console -> packages -> repo root
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
  return {
    // Absolute paths rather than npx: the agent's working directory is the
    // user's project, where tsx is usually not installed.
    command: join(repoRoot, "node_modules", ".bin", "tsx"),
    args: [join(repoRoot, "packages", "mcp", "src", "mcp-entry.mts")],
    autoApprove: AUTO_APPROVE,
  };
}

export function connectTarget(
  target: AgentTarget,
  mode: ConnectMode,
  options: { dryRun?: boolean } = {},
): ConnectOutcome {
  if (target.format !== "json") {
    return {
      target,
      status: "unsupported",
      detail: "TOML config not supported yet — add the entry by hand",
    };
  }
  const entry = serverEntry(mode);
  try {
    const existing = existsSync(target.configPath)
      ? (JSON.parse(readFileSync(target.configPath, "utf8")) as Record<string, unknown>)
      : {};
    const servers = (existing.mcpServers ?? {}) as Record<string, unknown>;
    const staleKeys = LEGACY_SERVER_KEYS.filter((key) => key in servers);

    if (JSON.stringify(servers[SERVER_KEY]) === JSON.stringify(entry) && staleKeys.length === 0) {
      return { target, status: "unchanged", detail: "already registered" };
    }
    if (options.dryRun) {
      const actions = [
        servers[SERVER_KEY] ? "would update existing entry" : "would add entry",
        ...(staleKeys.length > 0 ? [`would remove stale ${staleKeys.join(", ")}`] : []),
      ];
      return { target, status: "written", detail: actions.join("; ") };
    }

    let backupPath: string | undefined;
    if (existsSync(target.configPath)) {
      backupPath = `${target.configPath}.aws-blocks-devtools-backup`;
      if (!existsSync(backupPath)) copyFileSync(target.configPath, backupPath);
    } else {
      mkdirSync(dirname(target.configPath), { recursive: true });
    }

    const nextServers: Record<string, unknown> = { ...servers, [SERVER_KEY]: entry };
    for (const key of staleKeys) delete nextServers[key];
    const updated = { ...existing, mcpServers: nextServers };
    writeFileSync(target.configPath, `${JSON.stringify(updated, null, 2)}\n`);
    const preserved = Object.keys(servers).filter(
      (key) => key !== SERVER_KEY && !staleKeys.includes(key),
    ).length;
    return {
      target,
      status: "written",
      detail: `${preserved} existing server(s) preserved${
        staleKeys.length > 0 ? `, removed stale ${staleKeys.join(", ")}` : ""
      }`,
      ...(backupPath ? { backupPath } : {}),
    };
  } catch (error) {
    return {
      target,
      status: "failed",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}
