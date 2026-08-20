import { createServer } from "node:http";
import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { discoverBlocks } from "./discovery.js";
import { detectEnvironment } from "./detect.js";
import { readBlockData } from "./local-data.js";
import { readCloudBlockData } from "./cloud-data.js";
import { proxyRpc } from "./rpc-proxy.js";

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

function json(body: unknown, status = 200) {
  return {
    status,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

async function route(method: string, url: URL, body: string) {
  if (method === "POST" && url.pathname === "/console-api/rpc") {
    let parsed: { method?: unknown; params?: unknown };
    try {
      parsed = JSON.parse(body);
    } catch {
      return json({ error: "invalid JSON body" }, 400);
    }
    if (typeof parsed.method !== "string" || !Array.isArray(parsed.params)) {
      return json({ error: "expected { method: string, params: unknown[] }" }, 400);
    }
    return json(await proxyRpc({ method: parsed.method, params: parsed.params }));
  }
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
      return json({ projectPath, profile, region: region ?? null });
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
