import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

/**
 * Drives the MCP server the way an agent would: spawn it as a child process
 * over stdio, list its tools, call them. Verifies the real transport, not
 * just the handler functions.
 */
const projectPath = process.argv[2];
if (!projectPath) throw new Error("usage: verify-mcp.mts <project-path>");

const transport = new StdioClientTransport({
  command: "npx",
  args: ["tsx", new URL("./mcp-entry.mts", import.meta.url).pathname],
  cwd: projectPath,
  env: { ...process.env } as Record<string, string>,
});

const client = new Client({ name: "verify", version: "0.0.0" });
await client.connect(transport);

const { tools } = await client.listTools();
console.log("tools:", tools.map((t) => t.name).join(", "));

function firstText(result: unknown): string {
  const content = (result as { content?: { type: string; text?: string }[] }).content ?? [];
  return content.find((entry) => entry.type === "text")?.text ?? "";
}

const project = JSON.parse(firstText(await client.callTool({ name: "blocks_project", arguments: {} })));
console.log("project:", project.project.name, "| scope:", project.project.scope?.id);
console.log("blocks:", project.blocks.length, "| writesEnabled:", project.writesEnabled);
console.log("local up:", project.environments.local.serverUp, "| cloud stack:", project.environments.cloud.stackName, project.environments.cloud.stackFound);

const dataBlock = project.blocks.find((b: { type: string }) => b.type === "DistributedTable");
if (dataBlock) {
  const page = JSON.parse(
    firstText(await client.callTool({ name: "blocks_read", arguments: { blockId: dataBlock.fullId } })),
  );
  console.log(`read ${dataBlock.fullId}:`, page.totalRecords, "records | redacted:", page.redacted);
}

const api = project.blocks.find((b: { type: string }) => b.type === "ApiNamespace");
if (api?.methods?.length) {
  const method = `${api.id}.${api.methods[0].name}`;
  const rpc = JSON.parse(
    firstText(await client.callTool({ name: "blocks_rpc", arguments: { method, params: [] } })),
  );
  console.log(`rpc ${method}: status`, rpc.status, "| ok:", rpc.ok);
}

// Cloud RPC proves the deployed path independently of the local dev server.
const cloudRpc = await client.callTool({ name: "blocks_rpc", arguments: { method: `${api.id}.${api.methods[0].name}`, params: [], env: "cloud" } });
const cloudParsed = JSON.parse(firstText(cloudRpc));
console.log("cloud rpc: status", cloudParsed.status, "| ok:", cloudParsed.ok);

// Unknown block must fail loudly. MCP returns tool failures as isError
// results, not protocol rejections, so check the flag.
const bad = await client.callTool({ name: "blocks_read", arguments: { blockId: "definitely-not-a-block" } });
console.log("unknown block isError:", (bad as { isError?: boolean }).isError, "|", firstText(bad).slice(0, 55));

await client.close();
