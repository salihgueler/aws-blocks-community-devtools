import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { discoverBlocks } from "@aws-blocks-devtools/core";
import { detectEnvironment, localBlocksUrl } from "@aws-blocks-devtools/core";
import { readBlockData } from "@aws-blocks-devtools/core";
import { readCloudBlockData } from "@aws-blocks-devtools/core";
import { proxyRpc } from "@aws-blocks-devtools/core";
import { resolveProject } from "@aws-blocks-devtools/core";

/**
 * MCP adapter — a second transport over the same core the HTTP server uses.
 *
 * Design constraints that differ from the browser UI:
 * - No flags. The agent supplies only a working directory, so the project is
 *   resolved from it (see project.ts).
 * - No human in the loop. Read tools are always available; write tools are
 *   registered only when BLOCKS_CONSOLE_ALLOW_WRITES=1, because the UI's
 *   unlock gate assumes a person clicked it and an agent approving its own
 *   production delete is not a gate.
 */

import { MCP_WRITES_ENV } from "@aws-blocks-devtools/core";

// The SDK resolves credentials and region from the named profile; an agent
// passes no flags, so environment variables are the only override channel.
const cloudOptions = () => ({
  profile: process.env.AWS_PROFILE ?? "default",
  ...(process.env.AWS_REGION ? { region: process.env.AWS_REGION } : {}),
});

/** Every tool resolves the project the same way, and fails with guidance. */
function requireProject(explicit?: string): string {
  const resolution = resolveProject(explicit ?? process.cwd());
  if (resolution.ok) return resolution.project.path;
  if (resolution.reason === "ambiguous") {
    throw new Error(
      `Several Blocks projects found here. Pass project= one of: ${resolution.candidates.join(", ")}`,
    );
  }
  if (resolution.reason === "bad-override") {
    throw new Error(
      "BLOCKS_CONSOLE_PROJECT does not point at a Blocks project (no aws-blocks/index.ts)",
    );
  }
  throw new Error(
    "No AWS Blocks project found from the current directory. Run the agent from a project containing aws-blocks/index.ts, or pass project=<absolute path>.",
  );
}

const asText = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
});

export function createMcpServer(): McpServer {
  const server = new McpServer({ name: "aws-blocks-mcp", version: "0.1.0" });
  const writesEnabled = process.env[MCP_WRITES_ENV] === "1";

  server.registerTool(
    "blocks_project",
    {
      title: "Describe the AWS Blocks project",
      description:
        "Orient in an AWS Blocks project: which project is in scope, every Building Block it declares (type, id, category, source location, key schema, API methods), and whether the local dev server and a deployed stack are reachable. Call this first — other tools take ids from it.",
      inputSchema: {
        project: z
          .string()
          .optional()
          .describe("Absolute path to the project; defaults to the working directory"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ project }) => {
      const projectPath = requireProject(project);
      const inventory = discoverBlocks(projectPath);
      const namespaces = inventory.blocks
        .filter((block) => block.type === "ApiNamespace")
        .map((block) => block.id);
      const environment = await detectEnvironment(
        projectPath,
        process.env.AWS_PROFILE ?? "default",
        process.env.AWS_REGION,
        namespaces,
      );
      return asText({
        project: { path: projectPath, scope: inventory.scope, name: inventory.projectName },
        blocks: inventory.blocks,
        environments: {
          local: { ...environment.local, rpcUrl: `${localBlocksUrl(projectPath)}/aws-blocks/api` },
          cloud: environment.cloud,
        },
        writesEnabled,
        ...(writesEnabled
          ? {}
          : { writesNote: `Write tools are not registered. Set ${MCP_WRITES_ENV}=1 to enable them.` }),
      });
    },
  );

  server.registerTool(
    "blocks_read",
    {
      title: "Read records from a Building Block's store",
      description:
        "Read records from one block's data store. env=local reads the mock state in .bb-data/; env=cloud reads the deployed DynamoDB table or Cognito user pool. Credential-shaped values are redacted before returning. Blocks may own several stores — the response lists them and `store` selects one.",
      inputSchema: {
        blockId: z.string().describe("fullId from blocks_project, e.g. 'myapp-pages'"),
        env: z.enum(["local", "cloud"]).default("local"),
        store: z.string().optional().describe("Which of the block's stores to read"),
        project: z.string().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ blockId, env, store, project }) => {
      const projectPath = requireProject(project);
      const block = discoverBlocks(projectPath).blocks.find((b) => b.fullId === blockId);
      if (!block) throw new Error(`Unknown block: ${blockId}. Call blocks_project for valid ids.`);

      if (env === "cloud") {
        const environment = await detectEnvironment(
          projectPath,
          process.env.AWS_PROFILE ?? "default",
          process.env.AWS_REGION,
        );
        if (!environment.cloud.stackFound) {
          throw new Error(
            `No deployed stack found (looked for ${environment.cloud.candidates.join(" or ")} in ${environment.cloud.region ?? "?"}). Set AWS_PROFILE/AWS_REGION if it lives elsewhere.`,
          );
        }
        return asText(
          await readCloudBlockData(
            environment.cloud.stackName,
            blockId,
            block.type,
            cloudOptions(),
            store,
          ),
        );
      }
      return asText(readBlockData(projectPath, blockId, store));
    },
  );

  server.registerTool(
    "blocks_rpc",
    {
      title: "Call an ApiNamespace method",
      description:
        "Invoke a backend API method over JSON-RPC — against the local dev server or the deployed API. Method names and their parameter names come from blocks_project. Params are positional. Methods behind requireAuth will return an authentication error unless a session cookie is supplied.",
      inputSchema: {
        method: z.string().describe("namespace.methodName, e.g. 'api.listGames'"),
        params: z.array(z.unknown()).default([]).describe("Positional arguments"),
        env: z.enum(["local", "cloud"]).default("local"),
        cookie: z.string().optional().describe("Session cookie for auth-gated methods"),
        project: z.string().optional(),
      },
    },
    async ({ method, params, env, cookie, project }) => {
      const projectPath = requireProject(project);
      let endpoint = `${localBlocksUrl(projectPath)}/aws-blocks/api`;
      if (env === "cloud") {
        const environment = await detectEnvironment(
          projectPath,
          process.env.AWS_PROFILE ?? "default",
          process.env.AWS_REGION,
        );
        if (!environment.cloud.apiUrl) {
          throw new Error("No deployed ApiUrl found in the stack outputs.");
        }
        endpoint = environment.cloud.apiUrl;
      }
      return asText(await proxyRpc({ method, params }, endpoint, cookie));
    },
  );

  return server;
}

export async function startMcpServer(): Promise<void> {
  const server = createMcpServer();
  await server.connect(new StdioServerTransport());
}
