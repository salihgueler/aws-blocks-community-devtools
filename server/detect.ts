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

const LOCAL_BLOCKS_URL = "http://127.0.0.1:3000";
const PROBE_TIMEOUT_MS = 1500;

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

export async function detectLocal(projectPath: string): Promise<LocalEnvStatus> {
  const bbDataPresent = existsSync(join(projectPath, ".bb-data"));
  let serverUp = false;
  try {
    // JSON-RPC probe: an unknown method still proves the Blocks server is
    // answering (errors come back as HTTP 200 with an error body).
    const response = await fetch(`${LOCAL_BLOCKS_URL}/aws-blocks/api`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "console.__probe",
        params: [],
        id: 1,
      }),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    serverUp = response.ok;
  } catch {
    serverUp = false;
  }
  return { serverUp, serverUrl: LOCAL_BLOCKS_URL, bbDataPresent };
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
): Promise<EnvironmentStatus> {
  const [local, cloud] = await Promise.all([
    detectLocal(projectPath),
    detectCloud(projectPath, profile, region),
  ]);
  return { local, cloud };
}
