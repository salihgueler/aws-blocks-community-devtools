import { useMemo, useState } from "react";
import { useEnvironment, useInventory } from "./api";
import { DataBrowser, RpcPlayground } from "./panels";
import type { DiscoveredBlock, EnvMode } from "../shared/types";

const CATEGORY_LABELS: Record<string, string> = {
  core: "Core", auth: "Auth", data: "Data", storage: "Storage",
  messaging: "Messaging", compute: "Compute", ai: "AI", config: "Config",
  observability: "Observability", hosting: "Hosting", other: "Other",
};

export function App() {
  const inventory = useInventory();
  const environment = useEnvironment();
  const [mode, setMode] = useState<EnvMode>("local");
  const [selectedFullId, setSelectedFullId] = useState<string | null>(null);

  const grouped = useMemo(() => {
    const groups = new Map<string, DiscoveredBlock[]>();
    for (const block of inventory.data?.blocks ?? []) {
      const list = groups.get(block.category) ?? [];
      list.push(block);
      groups.set(block.category, list);
    }
    return groups;
  }, [inventory.data]);

  const selected =
    inventory.data?.blocks.find((b) => b.fullId === selectedFullId) ?? null;
  const local = environment.data?.local;
  const cloud = environment.data?.cloud;
  const cloudLabel = cloud
    ? `Cloud · ${cloud.profile} · ${cloud.accountId ?? "?"} · ${cloud.region ?? "?"}`
    : "Cloud";

  return (
    <div className="layout">
      <header className="topbar">
        <h1>Blocks Console</h1>
        <span className="project">
          {inventory.data ? inventory.data.projectName : "loading…"}
        </span>
        <div className="env-switch" role="group" aria-label="Environment">
          <button
            className={`env-pill ${mode === "local" ? "active" : ""}`}
            onClick={() => setMode("local")}
          >
            <span className={`dot ${local?.serverUp ? "up" : "down"}`} />
            Local{local && !local.serverUp ? " (server down)" : ""}
          </button>
          <button
            className={`env-pill ${mode === "cloud" ? "active" : ""} ${cloud?.stackFound ? "" : "unavailable"}`}
            onClick={() => cloud?.stackFound && setMode("cloud")}
            disabled={!cloud?.stackFound}
            title={cloud?.error ?? undefined}
          >
            <span className={`dot ${cloud?.stackFound ? "up" : "down"}`} />
            {cloudLabel}
          </button>
        </div>
      </header>
      <div className="main">
        <nav className="sidebar" aria-label="Building Blocks">
          {inventory.error && <div className="error-banner">{inventory.error}</div>}
          {[...grouped.entries()].map(([category, blocks]) => (
            <div key={category}>
              <div className="category">{CATEGORY_LABELS[category] ?? category}</div>
              {blocks.map((block) => (
                <button
                  key={block.fullId}
                  className={`block-item ${block.fullId === selectedFullId ? "selected" : ""}`}
                  onClick={() => setSelectedFullId(block.fullId)}
                >
                  {block.id} <span className="type">· {block.type}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>
        <main className="detail">
          {environment.data?.cloud.error && (
            <div className="error-banner">Cloud: {environment.data.cloud.error}</div>
          )}
          {selected ? (
            <BlockDetail
              block={selected}
              mode={mode}
              stackName={cloud?.stackFound ? cloud.stackName : null}
            />
          ) : (
            <div className="empty">
              {inventory.loading
                ? "Scanning project…"
                : "Select a Building Block to inspect it."}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function BlockDetail({
  block,
  mode,
  stackName,
}: {
  block: DiscoveredBlock;
  mode: EnvMode;
  stackName: string | null;
}) {
  const hasStore = ["data", "auth", "storage", "config"].includes(block.category);
  return (
    <>
      <h2>{block.id}</h2>
      <div className="meta">
        {block.type} · {block.fullId} · {block.file}:{block.line} · viewing: {mode}
      </div>
      {mode === "cloud" ? (
        hasStore && stackName ? (
          <DataBrowser
            fullId={block.fullId}
            query={{ env: "cloud", stack: stackName, blockType: block.type }}
          />
        ) : (
          <div className="card">
            <h3>Cloud data · read-only</h3>
            <div className="empty">No browsable cloud store for this block type.</div>
          </div>
        )
      ) : (
        <>
          {block.methods && block.methods.length > 0 && (
            <RpcPlayground namespace={block.id} methods={block.methods} />
          )}
          {hasStore && <DataBrowser fullId={block.fullId} query={{ env: "local" }} />}
        </>
      )}
      {block.configPreview && (
        <div className="card">
          <h3>Configuration (static preview)</h3>
          <pre className="code">{block.configPreview}</pre>
        </div>
      )}
    </>
  );
}
