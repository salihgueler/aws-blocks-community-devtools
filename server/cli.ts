import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { parseArgs } from "node:util";
import { startHttpServer } from "./main.js";
import { startMcpServer, WRITES_ENV } from "./mcp.js";
import { resolveProject, type ProjectResolution } from "./project.js";
import { detectEnvironment } from "./detect.js";
import { discoverBlocks } from "./discovery.js";
import {
  connectTarget,
  detectTargets,
  serverEntry,
  SERVER_KEY,
  type ConnectMode,
} from "./agent-config.js";

/**
 * The CLI is an installer/launcher, not a second implementation: every
 * subcommand delegates to the same core the MCP server uses.
 *
 *   blocks-console            serve the UI (default)
 *   blocks-console mcp        stdio MCP server (agents spawn this)
 *   blocks-console doctor     report what was detected, change nothing
 */

const DEFAULT_PORT = 4400;
const PORT_ATTEMPTS = 20;

export async function runCli(argv: string[]): Promise<number> {
  const command = argv[0] && !argv[0].startsWith("-") ? argv[0] : "serve";
  const rest = command === argv[0] ? argv.slice(1) : argv;

  // The MCP server owns stdout for protocol frames — parse nothing, log nothing.
  if (command === "mcp") {
    await startMcpServer();
    return 0;
  }

  const { values } = parseArgs({
    args: rest,
    options: {
      project: { type: "string", short: "p" },
      profile: { type: "string" },
      region: { type: "string" },
      port: { type: "string" },
      // Node's parseArgs has no boolean negation, so the flag is declared
      // in its negative form rather than as --open with an implicit --no-open.
      "no-open": { type: "boolean", default: false },
      local: { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
      agent: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: false,
  });

  if (values.help || command === "help") {
    printHelp();
    return 0;
  }

  const resolution = resolveProject(values.project ?? process.cwd());
  if (!resolution.ok) {
    reportUnresolved(resolution);
    return 1;
  }
  const projectPath = resolution.project.path;
  const profile = values.profile ?? process.env.AWS_PROFILE ?? "default";
  const region = values.region ?? process.env.AWS_REGION;

  if (command === "doctor") {
    await doctor(projectPath, profile, region);
    return 0;
  }
  if (command === "connect") {
    return connect({
      mode: values.local ? "local" : "published",
      dryRun: values["dry-run"] === true,
      only: values.agent,
    });
  }
  if (command !== "serve") {
    console.error(`Unknown command: ${command}\n`);
    printHelp();
    return 1;
  }

  const port = values.port ? Number(values.port) : await findFreePort(DEFAULT_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error(`Invalid port: ${values.port}`);
    return 1;
  }

  await startHttpServer({ projectPath, profile, region, port });
  const url = `http://127.0.0.1:${port}`;
  console.log(`Blocks Console  ${url}`);
  console.log(`  project  ${projectPath}  (found via ${resolution.project.via})`);
  console.log(`  aws      profile ${profile}${region ? `, region ${region}` : ""}`);
  if (!values["no-open"]) openBrowser(url);
  return 0;
}

/** Registers the MCP server with every installed agent. */
function connect(options: { mode: ConnectMode; dryRun: boolean; only?: string | undefined }): number {
  const detected = detectTargets().filter(
    (target) => !options.only || target.id === options.only,
  );
  if (detected.length === 0) {
    console.error(
      options.only
        ? `No installed agent with id '${options.only}'.`
        : "No supported agent configs found on this machine.",
    );
    return 1;
  }

  const entry = serverEntry(options.mode);
  console.log(`${options.dryRun ? "Would register" : "Registering"} '${SERVER_KEY}' (${options.mode} mode)`);
  console.log(`  command  ${String(entry.command)} ${(entry.args as string[]).join(" ")}\n`);

  let failed = false;
  for (const target of detected) {
    const outcome = connectTarget(target, options.mode, { dryRun: options.dryRun });
    const mark = { written: "ok", unchanged: "--", unsupported: "!!", failed: "XX" }[outcome.status];
    console.log(`  ${mark}  ${target.label.padEnd(12)} ${outcome.detail ?? ""}`);
    if (outcome.backupPath) console.log(`      backup: ${outcome.backupPath}`);
    if (outcome.status === "failed") failed = true;
  }

  if (!options.dryRun) {
    // MCP servers are spawned when the agent starts, so nothing appears until
    // the agent reloads. Saying so avoids the "why are there no tools" round trip.
    console.log("\nRestart or reload your agent for the tools to appear.");
  }
  return failed ? 1 : 0;
}

async function doctor(
  projectPath: string,
  profile: string,
  region: string | undefined,
): Promise<void> {
  const inventory = discoverBlocks(projectPath);
  const namespaces = inventory.blocks
    .filter((block) => block.type === "ApiNamespace")
    .map((block) => block.id);
  const environment = await detectEnvironment(projectPath, profile, region, namespaces);

  console.log(`project        ${projectPath}`);
  console.log(`scope          ${inventory.scope?.id ?? "(none found)"}`);
  console.log(`blocks         ${inventory.blocks.length}`);
  console.log(
    `local server   ${environment.local.serverUp ? environment.local.serverUrl : "not running"}` +
      (environment.local.matchesProject === false ? "  (serving a different project)" : ""),
  );
  console.log(
    environment.cloud.stackFound
      ? `deployed stack ${environment.cloud.stackName} (${environment.cloud.region}, account ${environment.cloud.accountId})`
      : `deployed stack none found (looked for ${environment.cloud.candidates.join(" or ")} in ${environment.cloud.region ?? "?"})`,
  );
  console.log(`agent writes   ${process.env[WRITES_ENV] === "1" ? "enabled" : `disabled (set ${WRITES_ENV}=1)`}`);
}

function reportUnresolved(resolution: Extract<ProjectResolution, { ok: false }>): void {
  if (resolution.reason === "ambiguous") {
    console.error("Several AWS Blocks projects found here. Pick one with --project:");
    for (const candidate of resolution.candidates) console.error(`  ${candidate}`);
    return;
  }
  if (resolution.reason === "bad-override") {
    console.error("BLOCKS_CONSOLE_PROJECT does not point at an AWS Blocks project.");
    return;
  }
  console.error(
    "No AWS Blocks project found here (looked for aws-blocks/index.ts in this directory and its parents).",
  );
  console.error("Run this from inside a Blocks project, or pass --project <path>.");
}

/** First free port at or above `start`, so a second console does not collide. */
async function findFreePort(start: number): Promise<number> {
  for (let port = start; port < start + PORT_ATTEMPTS; port += 1) {
    if (await isFree(port)) return port;
  }
  return start;
}

function isFree(port: number): Promise<boolean> {
  return new Promise((resolveFree) => {
    const probe = createServer();
    probe.once("error", () => resolveFree(false));
    probe.once("listening", () => probe.close(() => resolveFree(true)));
    probe.listen(port, "127.0.0.1");
  });
}

function openBrowser(url: string): void {
  const command =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  try {
    spawn(command, [url], { stdio: "ignore", detached: true }).unref();
  } catch {
    // Opening a browser is a convenience; the URL is already printed.
  }
}

function printHelp(): void {
  console.log(`blocks-console — inspect and interact with an AWS Blocks project

Usage
  blocks-console [serve] [options]   Serve the console UI (default)
  blocks-console mcp                 Run the MCP server over stdio
  blocks-console connect [--local]   Register the MCP server with your agents
  blocks-console doctor              Report what was detected

Options
  -p, --project <path>   Project to inspect (default: found from cwd)
      --profile <name>   AWS profile for cloud mode
      --region <region>  AWS region for cloud mode
      --port <port>      Port to serve on (default: first free from ${DEFAULT_PORT})
      --no-open          Do not open a browser
      --local            connect: point at this checkout instead of the npm package
      --dry-run          connect: show what would change, write nothing
      --agent <id>       connect: only this agent (kiro, cursor, claude-code, codex)
  -h, --help             Show this help

Environment
  ${WRITES_ENV}=1   Register write tools on the MCP server`);
}
