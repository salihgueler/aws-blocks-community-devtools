import { useEffect, useState } from "react";
import type {
  BlockDataPage,
  ResourceInventory,
  EnvironmentStatus,
  ProjectInventory,
  RpcResponse,
} from "@aws-blocks-devtools/core";

interface Loadable<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

/** Narrow guard for the one server->client boundary: every response is a JSON
 * object, so a non-object body means the server contract drifted (or a proxy
 * returned an HTML error page). Reject it here instead of asserting `body as T`
 * and crashing deep in a component. */
function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parse a response body as JSON, or return null when the body is not JSON
 * (proxy 502, HTML error page, empty body). Callers decide what a null means. */
async function parseJsonBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function useGet<T>(path: string, refreshKey = 0): Loadable<T> {
  const [state, setState] = useState<Loadable<T>>({
    data: null,
    error: null,
    loading: true,
  });
  useEffect(() => {
    let cancelled = false;
    // Reset to loading at the start of the effect so a path/refreshKey change
    // shows a spinner instead of the previous key's stale {data, loading:false}.
    setState({ data: null, error: null, loading: true });
    fetch(path)
      .then(async (response) => {
        const body = await parseJsonBody(response);
        if (cancelled) return;
        if (!response.ok) {
          const errText = isJsonObject(body) ? body.error : undefined;
          throw new Error(
            (typeof errText === "string" ? errText : undefined) ?? `HTTP ${response.status}`,
          );
        }
        if (!isJsonObject(body)) {
          throw new Error("Server returned a non-JSON response");
        }
        setState({ data: body as T, error: null, loading: false });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : String(error);
        setState({ data: null, error: message, loading: false });
      });
    return () => {
      cancelled = true;
    };
  }, [path, refreshKey]);
  return state;
}

export function useInventory(): Loadable<ProjectInventory> {
  return useGet<ProjectInventory>("/console-api/inventory");
}

export function useEnvironment(): Loadable<EnvironmentStatus> {
  return useGet<EnvironmentStatus>("/console-api/environment");
}

export function useResources(): Loadable<ResourceInventory> {
  return useGet<ResourceInventory>("/console-api/resources");
}

export interface DataQuery {
  env: "local" | "cloud";
  stack?: string;
  blockType?: string;
  /** Which of a block's stores to read (blocks can shard across several) */
  store?: string;
}

export function useBlockData(
  fullId: string,
  query: DataQuery,
  refreshKey = 0,
): Loadable<BlockDataPage> {
  const params = new URLSearchParams();
  if (query.env === "cloud") {
    params.set("env", "cloud");
    if (query.stack) params.set("stack", query.stack);
    if (query.blockType) params.set("type", query.blockType);
  }
  if (query.store) params.set("store", query.store);
  const suffix = params.size > 0 ? `?${params.toString()}` : "";
  return useGet<BlockDataPage>(
    `/console-api/data/${encodeURIComponent(fullId)}${suffix}`,
    refreshKey,
  );
}

async function postJson(path: string, payload: unknown): Promise<{ ok: boolean; message: string }> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await parseJsonBody(response);
  // A proxy 502 or an HTML error page yields a non-JSON body; surface a useful
  // message instead of throwing into callers that have no catch.
  if (!isJsonObject(body)) {
    return { ok: false, message: `Server error (HTTP ${response.status})` };
  }
  if (!response.ok) {
    return {
      ok: false,
      message: typeof body.error === "string" ? body.error : `HTTP ${response.status}`,
    };
  }
  return {
    ok: typeof body.ok === "boolean" ? body.ok : true,
    message: typeof body.message === "string" ? body.message : "done",
  };
}

export const setUnlock = (unlock: boolean): Promise<{ unlocked: boolean }> =>
  fetch("/console-api/unlock", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ unlock }),
  })
    .then(parseJsonBody)
    // A non-JSON body (proxy 502 / HTML) must not throw into the caller; fall
    // back to the safe read-only state so the lock button reflects reality.
    .then((body) => ({
      unlocked: isJsonObject(body) && typeof body.unlocked === "boolean" ? body.unlocked : false,
    }));

export const deleteCloudItem = (stack: string, fullId: string, key: Record<string, string>) =>
  postJson("/console-api/write/cloud-delete", { stack, fullId, key });

export const setCloudUserEnabled = (stack: string, fullId: string, username: string, enabled: boolean) =>
  postJson("/console-api/write/cloud-user", { stack, fullId, username, enabled });

export const deleteLocalRecord = (fullId: string, recordKey: string) =>
  postJson("/console-api/write/local-delete", { fullId, recordKey });

export const putCloudItem = (
  stack: string,
  fullId: string,
  item: Record<string, unknown>,
  mode: "create" | "edit",
) => postJson("/console-api/write/cloud-put", { stack, fullId, item, mode });

export const putLocalRecord = (
  fullId: string,
  item: Record<string, unknown>,
  mode: "create" | "edit",
) => postJson("/console-api/write/local-put", { fullId, item, mode });

export async function callRpc(
  method: string,
  params: unknown[],
  env: "local" | "cloud" = "local",
): Promise<RpcResponse> {
  const response = await fetch("/console-api/rpc", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ method, params, env }),
  });
  const body = await parseJsonBody(response);
  // A non-JSON body (proxy 502 / HTML error) must produce a well-formed
  // RpcResponse the playground can render, not an unguarded throw.
  if (!isJsonObject(body)) {
    return {
      ok: false,
      status: response.status,
      body: { error: `Server returned a non-JSON response (HTTP ${response.status})` },
      durationMs: 0,
    };
  }
  return body as unknown as RpcResponse;
}
