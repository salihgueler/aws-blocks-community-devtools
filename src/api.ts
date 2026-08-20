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

export function useBlockData(fullId: string): Loadable<BlockDataPage> {
  return useGet<BlockDataPage>(`/console-api/data/${encodeURIComponent(fullId)}`);
}

export async function callRpc(method: string, params: unknown[]): Promise<RpcResponse> {
  const response = await fetch("/console-api/rpc", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ method, params }),
  });
  return (await response.json()) as RpcResponse;
}
