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

export const SERVER_KEY = "blocks-console";

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
 * `published` points at the npm package; `local` points at this checkout's own
 * tsx binary and entry file, which works before the package is published and
 * keeps following the working tree as it changes.
 */
export function serverEntry(mode: ConnectMode): Record<string, unknown> {
  if (mode === "published") {
    return { command: "npx", args: ["-y", "blocks-console", "mcp"], autoApprove: AUTO_APPROVE };
  }
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  return {
    // Absolute paths rather than npx: the agent's working directory is the
    // user's project, where tsx is usually not installed.
    command: join(packageRoot, "node_modules", ".bin", "tsx"),
    args: [join(packageRoot, "scripts", "mcp-entry.mts")],
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

    if (JSON.stringify(servers[SERVER_KEY]) === JSON.stringify(entry)) {
      return { target, status: "unchanged", detail: "already registered" };
    }
    if (options.dryRun) {
      return {
        target,
        status: "written",
        detail: servers[SERVER_KEY] ? "would update existing entry" : "would add entry",
      };
    }

    let backupPath: string | undefined;
    if (existsSync(target.configPath)) {
      backupPath = `${target.configPath}.blocks-console-backup`;
      if (!existsSync(backupPath)) copyFileSync(target.configPath, backupPath);
    } else {
      mkdirSync(dirname(target.configPath), { recursive: true });
    }

    const updated = { ...existing, mcpServers: { ...servers, [SERVER_KEY]: entry } };
    writeFileSync(target.configPath, `${JSON.stringify(updated, null, 2)}\n`);
    return {
      target,
      status: "written",
      detail: `${Object.keys(servers).length} existing server(s) preserved`,
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
