// Dev entry: runs the MCP server straight from TypeScript source via tsx, so a
// code change is picked up on the next agent restart with no build step. The
// published path is bin/aws-blocks-mcp.mjs, which loads the bundled dist.
import { startMcpServer } from "./mcp.js";

await startMcpServer();
