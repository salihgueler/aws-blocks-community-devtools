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
  const namespace = request.method.slice(0, request.method.indexOf("."));
  const send = (url: string): Promise<Response> =>
    fetch(url, {
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
  try {
    // Since @aws-blocks/blocks 0.9.0 the typed client posts to
    // `<base>/{namespace}`, and the gateway routes that path to the compute
    // hosting the namespace. The bare base only reaches the default compute.
    // Stacks deployed before 0.9.0 have no per-namespace route, so fall back
    // to the bare endpoint when the gateway does not know the path. Only a
    // response that is not a JSON-RPC envelope counts as "unknown route": a
    // JSON-RPC reply came from the Blocks runtime, so the method already ran
    // and calling it again would execute it twice.
    let response = await send(namespaceRequestUrl(endpoint, namespace));
    let body = await readJson(response);
    if ((response.status === 403 || response.status === 404) && !isJsonRpcEnvelope(body)) {
      response = await send(endpoint);
      body = await readJson(response);
    }
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

/**
 * Append `/{namespace}` to an RPC base URL, the same way the 0.9.0 typed
 * client does. Trailing slashes are trimmed with a loop rather than a regex.
 */
export function namespaceRequestUrl(baseUrl: string, namespace: string): string {
  let end = baseUrl.length;
  while (end > 0 && baseUrl.charCodeAt(end - 1) === 47) end--;
  return `${baseUrl.slice(0, end)}/${namespace}`;
}

async function readJson(response: Response): Promise<unknown> {
  return response.json().catch(() => null);
}

function isJsonRpcEnvelope(body: unknown): boolean {
  return typeof body === "object" && body !== null && "jsonrpc" in body;
}
