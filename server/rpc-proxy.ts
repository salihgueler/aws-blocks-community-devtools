import type { RpcRequest, RpcResponse } from "../shared/types.js";

const LOCAL_RPC_URL = "http://127.0.0.1:3000/aws-blocks/api";
const RPC_TIMEOUT_MS = 30_000;

/**
 * Forward a JSON-RPC call to the local Blocks dev server. Proxying (rather
 * than calling from the browser) keeps the UI same-origin and gives us one
 * seam to point at the deployed execute-api URL in Phase 3.
 *
 * Method names are validated against the JSON-RPC `namespace.method` shape;
 * params pass through verbatim (positional array, per the wire protocol).
 */
export async function proxyRpc(request: RpcRequest): Promise<RpcResponse> {
  if (!/^[A-Za-z_$][\w$]*\.[A-Za-z_$][\w$]*$/.test(request.method)) {
    return {
      ok: false,
      status: 400,
      body: { error: "method must look like namespace.methodName" },
      durationMs: 0,
    };
  }
  const started = performance.now();
  try {
    const response = await fetch(LOCAL_RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: request.method,
        params: request.params,
        id: Date.now(),
      }),
      signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
    });
    const body = await response.json().catch(() => null);
    return {
      ok: response.ok,
      status: response.status,
      body,
      durationMs: Math.round(performance.now() - started),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      status: 502,
      body: { error: `local Blocks server unreachable: ${message}` },
      durationMs: Math.round(performance.now() - started),
    };
  }
}
