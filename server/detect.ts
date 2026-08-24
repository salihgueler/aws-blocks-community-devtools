import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CloudFormationClient,
  DescribeStacksCommand,
} from "@aws-sdk/client-cloudformation";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import type {
  CloudEnvStatus,
  EnvironmentStatus,
  LocalEnvStatus,
} from "../shared/types.js";

const DEFAULT_LOCAL_PORT = 3000;
const PROBE_TIMEOUT_MS = 1500;

/**
 * The local dev server port is per project, not a constant: each project's
 * `aws-blocks/scripts/server.ts` passes its own `port:` (some projects use 3001
 * so its Vite client can own 3000). Read it rather than assuming.
 */
export function resolveLocalPort(projectPath: string): number {
  const scriptPath = join(projectPath, "aws-blocks", "scripts", "server.ts");
  if (!existsSync(scriptPath)) return DEFAULT_LOCAL_PORT;
  const match = /\bport\s*:\s*(\d{2,5})\b/.exec(readFileSync(scriptPath, "utf8"));
  const port = match?.[1] ? Number(match[1]) : NaN;
  return Number.isInteger(port) && port > 0 && port < 65536
    ? port
    : DEFAULT_LOCAL_PORT;
}

export function localBlocksUrl(projectPath: string): string {
  return `http://127.0.0.1:${resolveLocalPort(projectPath)}`;
}

/**
 * Deployed stack name candidates, mirroring @aws-blocks/core getStackName():
 * production is `<stackId>-prod`; a sandbox is `<stackId>-<sandboxId>` where
 * the sandbox id persists in `.blocks-sandbox/sandbox-id.txt`. Prod first.
 */
export function stackNameCandidates(projectPath: string): string[] {
  const configPath = join(projectPath, ".blocks", "config.json");
  let stackId: string | null = null;
  if (existsSync(configPath)) {
    try {
      const parsed = JSON.parse(readFileSync(configPath, "utf8"));
      if (typeof parsed.stackId === "string" && parsed.stackId) stackId = parsed.stackId;
    } catch {
      stackId = null;
    }
  }
  if (!stackId) {
    const packagePath = join(projectPath, "package.json");
    stackId = JSON.parse(readFileSync(packagePath, "utf8")).name as string;
  }
  const candidates = [`${stackId}-prod`];
  const sandboxIdPath = join(projectPath, ".blocks-sandbox", "sandbox-id.txt");
  if (existsSync(sandboxIdPath)) {
    const sandboxId = readFileSync(sandboxIdPath, "utf8").trim();
    if (sandboxId) candidates.push(`${stackId}-${sandboxId}`);
  }
  return candidates;
}

export async function detectLocal(
  projectPath: string,
  expectedNamespaces: string[] = [],
): Promise<LocalEnvStatus> {
  const bbDataPresent = existsSync(join(projectPath, ".bb-data"));
  const baseUrl = localBlocksUrl(projectPath);
  let serverUp = false;
  let namespaces: string[] = [];
  try {
    // Probing a deliberately unknown namespace is side-effect free and the
    // error names every namespace the running server exposes:
    //   "Method not found: API 'x' not found. Available: api, admin"
    // That is the only identity signal the dev server offers — it cannot
    // confirm the project, but a mismatch proves it is a different one.
    const response = await fetch(`${baseUrl}/aws-blocks/api`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "__blocksConsoleProbe__.__probe__",
        params: [],
        id: 1,
      }),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    serverUp = response.ok;
    if (serverUp) {
      const body = (await response.json()) as {
        error?: { message?: string };
      };
      const match = /Available:\s*(.+)$/.exec(body.error?.message ?? "");
      if (match?.[1]) {
        namespaces = match[1]
          .split(",")
          .map((name) => name.trim())
          .filter(Boolean);
      }
    }
  } catch {
    serverUp = false;
  }
  // null = cannot tell (no namespaces reported, or nothing to compare against)
  let matchesProject: boolean | null = null;
  if (serverUp && namespaces.length > 0 && expectedNamespaces.length > 0) {
    matchesProject = expectedNamespaces.every((name) => namespaces.includes(name));
  }
  // Namespace names are weak evidence — most projects call theirs "api". The
  // dev server also serves the project's own frontend, so when the project
  // ships a static index.html with a <title>, comparing it against what :3000
  // actually serves is a decisive check (and catches a foreign server that
  // happens to share namespace names).
  if (serverUp) {
    const expectedTitle = readProjectTitle(projectPath);
    if (expectedTitle) {
      const servedTitle = await fetchServedTitle(baseUrl);
      if (servedTitle !== null) {
        matchesProject = servedTitle.trim() === expectedTitle.trim();
      }
    }
  }
  return { serverUp, serverUrl: baseUrl, bbDataPresent, namespaces, matchesProject };
}

/** <title> from the project's static index.html, when it has one. */
function readProjectTitle(projectPath: string): string | null {
  const indexPath = join(projectPath, "index.html");
  if (!existsSync(indexPath)) return null;
  const match = /<title>([^<]*)<\/title>/i.exec(readFileSync(indexPath, "utf8"));
  return match?.[1] ?? null;
}

async function fetchServedTitle(baseUrl: string): Promise<string | null> {
  try {
    const response = await fetch(baseUrl, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const match = /<title>([^<]*)<\/title>/i.exec(await response.text());
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

export async function detectCloud(
  projectPath: string,
  profile: string,
  region: string | undefined,
): Promise<CloudEnvStatus> {
  const candidates = stackNameCandidates(projectPath);
  const base: CloudEnvStatus = {
    stackFound: false,
    stackName: candidates[0] ?? "unknown",
    profile,
    region: region ?? null,
    accountId: null,
    stackStatus: null,
    error: null,
    apiUrl: null,
    candidates,
  };
  try {
    // The SDK's top-level `profile` option resolves credentials AND region
    // from that profile (explicit `region` arg still wins if provided).
    const clientConfig = { profile, ...(region ? { region } : {}) };
    const sts = new STSClient(clientConfig);
    const identity = await sts.send(new GetCallerIdentityCommand({}));
    base.accountId = identity.Account ?? null;
    base.region = (await sts.config.region()) ?? null;

    const cloudFormation = new CloudFormationClient(clientConfig);
    for (const stackName of candidates) {
      try {
        const stacks = await cloudFormation.send(
          new DescribeStacksCommand({ StackName: stackName }),
        );
        const stack = stacks.Stacks?.[0];
        if (stack) {
          base.stackFound = true;
          base.stackName = stackName;
          base.stackStatus = stack.StackStatus ?? null;
          // The JSON-RPC endpoint of the deployed API, published as an output.
          base.apiUrl =
            stack.Outputs?.find((output) => output.OutputKey === "ApiUrl")
              ?.OutputValue ?? null;
          break;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // "Stack ... does not exist" is a clean negative — try next candidate.
        if (!/does not exist/i.test(message)) throw error;
      }
    }
  } catch (error) {
    base.error = error instanceof Error ? error.message : String(error);
  }
  return base;
}

export async function detectEnvironment(
  projectPath: string,
  profile: string,
  region: string | undefined,
  expectedNamespaces: string[] = [],
): Promise<EnvironmentStatus> {
  const [local, cloud] = await Promise.all([
    detectLocal(projectPath, expectedNamespaces),
    detectCloud(projectPath, profile, region),
  ]);
  return { local, cloud };
}
