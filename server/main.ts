import { createServer } from "node:http";
import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { discoverBlocks } from "./discovery.js";
import { detectEnvironment } from "./detect.js";

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

async function route(method: string, url: URL) {
  if (method !== "GET") return json({ error: "method not allowed" }, 405);
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
  try {
    const result = await route(request.method ?? "GET", url);
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
