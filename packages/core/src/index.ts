/**
 * Transport-free core shared by both published packages.
 *
 * Nothing in here knows about HTTP or stdio: the console package wraps these
 * functions in an HTTP server, the mcp package wraps them in stdio tools. That
 * is the whole reason this package exists — the two adapters were built over
 * one core, and duplicating it per package is how the two copies drift apart.
 *
 * This package is NOT published. Both packages bundle it into their own dist at
 * build time, so consumers install exactly two things.
 */

export * from "./types.js";
export { MCP_WRITES_ENV } from "./contracts.js";

export { discoverBlocks } from "./discovery.js";
export { resolveProject, isBlocksProject } from "./project.js";
export type { ResolvedProject, ProjectResolution } from "./project.js";
export {
  resolveLocalPort,
  localBlocksUrl,
  stackNameCandidates,
  detectLocal,
  detectCloud,
  detectEnvironment,
} from "./detect.js";
export { readBlockData } from "./local-data.js";
export { readCloudBlockData } from "./cloud-data.js";
export { listAllResources, resolveBlockResources } from "./cloud-resources.js";
export type { BlockResources, CloudClientOptions } from "./cloud-resources.js";
export { SECRET_KEY_PATTERN, REDACTED, orderStores, looksSecret, redactValue } from "./redact.js";
export { proxyRpc } from "./rpc-proxy.js";
