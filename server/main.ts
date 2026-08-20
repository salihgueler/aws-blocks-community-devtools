import { createServer } from "node:http";
import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { discoverBlocks } from "./discovery.js";
import { detectEnvironment } from "./detect.js";
import { readBlockData } from "./local-data.js";
import { readCloudBlockData } from "./cloud-data.js";
import { proxyRpc } from "./rpc-proxy.js";
import { isUnlocked, setUnlocked, unlockExpiresInMs } from "./write-guard.js";
import {
  deleteCloudItem,
  deleteLocalRecord,
  setCloudUserEnabled,
} from "./writes.js";

/**
 * Console backend. Deliberately localhost-only: it holds no auth because it
 * never leaves the developer's machine. AWS access is read-only in Phase 1
 * (STS GetCallerIdentity + CloudFormation DescribeStacks) via the named
 * profile — credentials are resolved by the SDK, never stored or logged.
 */

const { values: args } = parseArgs({
  options: {
    project: { type: "string", short: "p" },
    profile: { type: "string" },
    region: { type: "string" },
    port: { type: "string" },
  },
});

const projectPath = resolve(
  args.project ?? process.env.BLOCKS_CONSOLE_PROJECT ?? process.cwd(),
);
const profile = args.profile ?? process.env.AWS_PROFILE ?? "default";
const region = args.region ?? process.env.AWS_REGION;
const port = Number(args.port ?? 4401);

async function routePost(url: URL, body: string) {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(body);
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }
  const cloudOptions = { profile, ...(region ? { region } : {}) };

  switch (url.pathname) {
    case "/console-api/rpc": {
      if (typeof parsed.method !== "string" || !Array.isArray(parsed.params)) {
        return json({ error: "expected { method: string, params: unknown[] }" }, 400);
      }
      return json(await proxyRpc({ method: parsed.method, params: parsed.params }));
    }
    case "/console-api/unlock": {
      setUnlocked(parsed.unlock === true);
      return json({ unlocked: isUnlocked(), expiresInMs: unlockExpiresInMs() });
    }
    case "/console-api/write/cloud-delete": {
      if (!isUnlocked()) return json({ error: "cloud writes are locked" }, 403);
      const { stack, fullId, key } = parsed;
      if (typeof stack !== "string" || typeof fullId !== "string" || typeof key !== "object" || key === null) {
        return json({ error: "expected { stack, fullId, key }" }, 400);
      }
      return json(
        await deleteCloudItem(stack, fullId, key as Record<string, unknown>, cloudOptions),
      );
    }
    case "/console-api/write/cloud-user": {
      if (!isUnlocked()) return json({ error: "cloud writes are locked" }, 403);
      const { stack, fullId, username, enabled } = parsed;
      if (typeof stack !== "string" || typeof fullId !== "string" || typeof username !== "string" || typeof enabled !== "boolean") {
        return json({ error: "expected { stack, fullId, username, enabled }" }, 400);
      }
      return json(await setCloudUserEnabled(stack, fullId, username, enabled, cloudOptions));
    }
    case "/console-api/write/local-delete": {
      const { fullId, recordKey } = parsed;
      if (typeof fullId !== "string" || typeof recordKey !== "string") {
        return json({ error: "expected { fullId, recordKey }" }, 400);
      }
      return json(await deleteLocalRecord(projectPath, fullId, recordKey));
    }
    default:
      return json({ error: "not found" }, 404);
  }
}

function json(body: unknown, status = 200) {
  return {
    status,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

async function route(method: string, url: URL, body: string) {
  if (method === "POST") return routePost(url, body);
  if (method !== "GET") return json({ error: "method not allowed" }, 405);
  const dataMatch = url.pathname.match(/^\/console-api\/data\/([\w.-]+)$/);
  if (dataMatch?.[1]) {
    const fullId = dataMatch[1];
    if (url.searchParams.get("env") === "cloud") {
      const stackName = url.searchParams.get("stack");
      const blockType = url.searchParams.get("type") ?? "";
      if (!stackName || !/^[\w-]+$/.test(stackName)) {
        return json({ error: "cloud data requires a valid ?stack= name" }, 400);
      }
      return json(
        await readCloudBlockData(stackName, fullId, blockType, {
          profile,
          ...(region ? { region } : {}),
        }),
      );
    }
    return json(readBlockData(projectPath, fullId));
  }
  switch (url.pathname) {
    case "/console-api/inventory":
      return json(discoverBlocks(projectPath));
    case "/console-api/environment":
      return json(await detectEnvironment(projectPath, profile, region));
    case "/console-api/meta":
      return json({
        projectPath,
        profile,
        region: region ?? null,
        unlocked: isUnlocked(),
        unlockExpiresInMs: unlockExpiresInMs(),
      });
    default:
      return json({ error: "not found" }, 404);
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  try {
    const result = await route(
      request.method ?? "GET",
      url,
      Buffer.concat(chunks).toString("utf8"),
    );
    response.writeHead(result.status, result.headers);
    response.end(result.body);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    response.writeHead(500, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: message }));
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`[blocks-console] backend on http://127.0.0.1:${port}`);
  console.log(`[blocks-console] project: ${projectPath}`);
  console.log(`[blocks-console] profile: ${profile}${region ? ` region: ${region}` : ""}`);
});
