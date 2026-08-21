import { useMemo, useState } from "react";
import { setUnlock, useEnvironment, useInventory } from "./api";
import { DataBrowser, RpcPlayground } from "./panels";
import { BlockTile, LogoMark } from "./tiles";
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
  const [selectedFullId, setSelectedFullId] = useState<string | null>(
    () => new URLSearchParams(window.location.search).get("block"),
  );
  const [unlocked, setUnlocked] = useState(false);

  function selectBlock(fullId: string) {
    setSelectedFullId(fullId);
    const url = new URL(window.location.href);
    url.searchParams.set("block", fullId);
    window.history.replaceState(null, "", url);
  }

  async function toggleUnlock() {
    if (
      !unlocked &&
      !window.confirm(
        "Unlock writes against the DEPLOYED stack? Deletes and user changes will hit production. Auto-relocks after 15 minutes.",
      )
    )
      return;
    const result = await setUnlock(!unlocked);
    setUnlocked(result.unlocked);
  }

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
        <span className="brand">
          <LogoMark />
          <h1>Blocks Console</h1>
        </span>
        <span className="project">
          {inventory.data ? inventory.data.projectName : "loading…"}
        </span>
        <div className="env-switch" role="group" aria-label="Environment">
          <button
            className={`env-pill ${mode === "local" ? "active" : ""} ${local?.matchesProject === false ? "mismatch" : ""}`}
            onClick={() => setMode("local")}
            title={
              local?.matchesProject === false
                ? "A dev server is running on :3000 but it is serving a different project"
                : undefined
            }
          >
            <span className={`dot ${local?.serverUp && local?.matchesProject !== false ? "up" : "down"}`} />
            {!local?.serverUp
              ? "Local (server down)"
              : local.matchesProject === false
                ? "Local (other project on :3000)"
                : "Local"}
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
          {mode === "cloud" && cloud?.stackFound && (
            <button
              className={`env-pill lock ${unlocked ? "unlocked" : ""}`}
              onClick={toggleUnlock}
              title={unlocked ? "Writes enabled — click to relock" : "Writes locked — click to unlock"}
            >
              {unlocked ? "🔓 writes ON" : "🔒 read-only"}
            </button>
          )}
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
                  onClick={() => selectBlock(block.fullId)}
                >
                  <BlockTile type={block.type} category={block.category} size={22} />
                  <span className="block-item-text">
                    {block.id} <span className="type">{block.type}</span>
                  </span>
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
              unlocked={unlocked}
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
  unlocked,
}: {
  block: DiscoveredBlock;
  mode: EnvMode;
  stackName: string | null;
  unlocked: boolean;
}) {
  const hasStore = ["data", "auth", "storage", "config"].includes(block.category);
  return (
    <div className="detail-enter" key={block.fullId}>
      <div className="detail-head">
        <BlockTile type={block.type} category={block.category} size={40} />
        <div>
          <h2>{block.id}</h2>
          <div className="meta">
            {block.type} · {block.fullId} · {block.file}:{block.line} · viewing: {mode}
          </div>
        </div>
      </div>
      {mode === "cloud" ? (
        <>
          {block.methods && block.methods.length > 0 && (
            <RpcPlayground namespace={block.id} methods={block.methods} env="cloud" />
          )}
          {hasStore && stackName ? (
            <DataBrowser
              fullId={block.fullId}
              query={{ env: "cloud", stack: stackName, blockType: block.type }}
              blockType={block.type}
              unlocked={unlocked}
              keySchema={block.keySchema}
            />
          ) : (
            hasStore && (
              <div className="card">
                <h3>Cloud data · read-only</h3>
                <div className="empty">No deployed stack found for this project.</div>
              </div>
            )
          )}
        </>
      ) : (
        <>
          {block.methods && block.methods.length > 0 && (
            <RpcPlayground namespace={block.id} methods={block.methods} env="local" />
          )}
          {hasStore && (
            <DataBrowser
              fullId={block.fullId}
              query={{ env: "local" }}
              blockType={block.type}
              unlocked={true}
              keySchema={block.keySchema}
            />
          )}
        </>
      )}
      {block.configPreview && (
        <div className="card">
          <h3>Configuration (static preview)</h3>
          <pre className="code">{block.configPreview}</pre>
        </div>
      )}
    </div>
  );
}
