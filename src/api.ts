import { useEffect, useState } from "react";
import type {
  BlockDataPage,
  EnvironmentStatus,
  ProjectInventory,
  RpcResponse,
} from "../shared/types";

interface Loadable<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

function useGet<T>(path: string): Loadable<T> {
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
  }, [path]);
  return state;
}

export function useInventory(): Loadable<ProjectInventory> {
  return useGet<ProjectInventory>("/console-api/inventory");
}

export function useEnvironment(): Loadable<EnvironmentStatus> {
  return useGet<EnvironmentStatus>("/console-api/environment");
}

export interface DataQuery {
  env: "local" | "cloud";
  stack?: string;
  blockType?: string;
}

export function useBlockData(fullId: string, query: DataQuery): Loadable<BlockDataPage> {
  const params = new URLSearchParams();
  if (query.env === "cloud") {
    params.set("env", "cloud");
    if (query.stack) params.set("stack", query.stack);
    if (query.blockType) params.set("type", query.blockType);
  }
  const suffix = params.size > 0 ? `?${params.toString()}` : "";
  return useGet<BlockDataPage>(
    `/console-api/data/${encodeURIComponent(fullId)}${suffix}`,
  );
}

export async function callRpc(method: string, params: unknown[]): Promise<RpcResponse> {
  const response = await fetch("/console-api/rpc", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ method, params }),
  });
  return (await response.json()) as RpcResponse;
}
