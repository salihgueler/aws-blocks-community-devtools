/**
 * Contracts shared across package boundaries.
 *
 * These are strings both published packages must agree on exactly. They live
 * here rather than in whichever package happens to enforce them, because a
 * magic string copied into two packages is a rename away from silently
 * disagreeing — the MCP server would gate on one name while the console
 * reported on another, and nothing would fail loudly.
 */

/**
 * Set to "1" to register the MCP server's write tools.
 *
 * Enforced by aws-blocks-mcp (the tools are not registered at all without it, so
 * an agent cannot call them) and merely REPORTED by aws-blocks-console's doctor.
 * Absent by default: an agent should not be able to delete production rows
 * unattended, and the console's interactive unlock gate stays the path for
 * human-in-the-loop writes.
 */
export const MCP_WRITES_ENV = "AWS_BLOCKS_MCP_ALLOW_WRITES";
