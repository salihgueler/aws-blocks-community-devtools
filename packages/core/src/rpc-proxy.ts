import type { RpcRequest, RpcResponse } from "./types.js";

const RPC_TIMEOUT_MS = 30_000;

/**
 * Forward a JSON-RPC call to a Blocks API. `endpoint` is the local dev server
 * by default, or the deployed stack's ApiUrl output for cloud mode — this
 * function is the single seam both modes share.
 *
 * Method names are validated against the JSON-RPC `namespace.method` shape;
 * params pass through verbatim (positional array, per the wire protocol).
 * Cookies are forwarded when supplied so auth-gated methods are reachable.
 */
export async function proxyRpc(
  request: RpcRequest,
  endpoint: string,
  cookie?: string,
): Promise<RpcResponse> {
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
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cookie ? { Cookie: cookie } : {}),
      },
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
      body: { error: `Blocks API unreachable at ${endpoint}: ${message}` },
      durationMs: Math.round(performance.now() - started),
    };
  }
}
