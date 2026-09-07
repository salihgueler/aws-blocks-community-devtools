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

function useGet<T>(path: string, refreshKey = 0): Loadable<T> {
  const [state, setState] = useState<Loadable<T>>({
    data: null,
    error: null,
    loading: true,
  });
  useEffect(() => {
    let cancelled = false;
    fetch(path)
      .then(async (response) => {
        const body = await response.json();
        if (cancelled) return;
        if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
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
  const body = await response.json();
  if (!response.ok) return { ok: false, message: body.error ?? `HTTP ${response.status}` };
  return { ok: body.ok ?? true, message: body.message ?? "done" };
}

export const setUnlock = (unlock: boolean) =>
  fetch("/console-api/unlock", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ unlock }),
  }).then((r) => r.json() as Promise<{ unlocked: boolean }>);

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
  return (await response.json()) as RpcResponse;
}
