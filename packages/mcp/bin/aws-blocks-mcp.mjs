#!/usr/bin/env node
// Published entry point. Resolves the bundled build, which has the shared core
// compiled in, so an install pulls no extra package.
import { startMcpServer } from "../dist/mcp.js";

await startMcpServer();
