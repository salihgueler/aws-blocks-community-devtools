import { useState } from "react";
import {
  callRpc,
  deleteCloudItem,
  deleteLocalRecord,
  setCloudUserEnabled,
  useBlockData,
  type DataQuery,
} from "./api";
import { JsonView } from "./JsonView";
import type { ApiMethod, RpcResponse } from "../shared/types";

/** One-line preview for a collapsed record: top-level keys with scalar values. */
function summarize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "";
  if (Array.isArray(value)) return `[ ${value.length} item${value.length === 1 ? "" : "s"} ]`;
  const parts = Object.entries(value).map(([key, field]) => {
    if (field === null || typeof field !== "object") {
      const text = JSON.stringify(field) ?? "";
      return `${key}: ${text.length > 24 ? `${text.slice(0, 24)}…` : text}`;
    }
    return `${key}: ${Array.isArray(field) ? `[${field.length}]` : "{…}"}`;
  });
  return parts.join("  ·  ");
}

export function DataBrowser({
  fullId,
  query,
  blockType,
  unlocked,
}: {
  fullId: string;
  query: DataQuery;
  blockType: string;
  unlocked: boolean;
}) {
  const [refreshKey, setRefreshKey] = useState(0);
  const { data, error, loading } = useBlockData(fullId, query, refreshKey);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const isCloud = query.env === "cloud";
  const isCognito = isCloud && blockType.startsWith("Auth");
  const canWrite = isCloud ? unlocked : true;
  const title = isCloud ? "Cloud data · read-only unless unlocked" : "Local data";

  async function removeRecord(recordKey: string) {
    const target = isCloud ? "PRODUCTION" : "local mock";
    if (!window.confirm(`Delete ${recordKey} from the ${target} store? This cannot be undone.`)) return;
    const result = isCloud
      ? await deleteCloudItem(query.stack ?? "", fullId, parseDynamoKey(recordKey))
      : await deleteLocalRecord(fullId, recordKey);
    setNotice(result.message);
    if (result.ok) setRefreshKey((k) => k + 1);
  }

  async function toggleUser(username: string, enabled: boolean) {
    if (!window.confirm(`${enabled ? "Enable" : "Disable"} ${username} in the PRODUCTION user pool?`)) return;
    const result = await setCloudUserEnabled(query.stack ?? "", fullId, username, enabled);
    setNotice(result.message);
    if (result.ok) setRefreshKey((k) => k + 1);
  }

  if (loading) return <div className="card"><h3>{title}</h3><div className="empty">Loading…</div></div>;
  const problem = error ?? data?.error;
  if (problem || !data) {
    return <div className="card"><h3>{title}</h3><div className="empty">{problem ?? "no data"}</div></div>;
  }
  return (
    <div className="card">
      <h3>
        {title} · {data.source} · {data.totalRecords} record{data.totalRecords === 1 ? "" : "s"}
        {data.redacted ? " · secrets redacted" : ""}
      </h3>
      {notice && <div className="notice">{notice}</div>}
      {data.records.length === 0 ? (
        <div className="empty">Store is empty.</div>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Key</th>
              <th scope="col">Value</th>
              {canWrite && <th scope="col">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {data.records.map((record) => {
              const expanded = expandedKey === record.key;
              const userEnabled = isCognito
                ? (record.value as { enabled?: boolean }).enabled !== false
                : true;
              return (
                <tr key={record.key}>
                  <td className="key-cell">{record.key}</td>
                  <td>
                    <button
                      className="value-toggle"
                      onClick={() => setExpandedKey(expanded ? null : record.key)}
                      aria-expanded={expanded}
                    >
                      {expanded ? (
                        <JsonView value={record.value} />
                      ) : (
                        <span className="value-summary">{summarize(record.value)}</span>
                      )}
                    </button>
                  </td>
                  {canWrite && (
                    <td className="actions-cell">
                      {isCognito ? (
                        <button
                          className="row-action"
                          onClick={() => toggleUser(record.key, !userEnabled)}
                        >
                          {userEnabled ? "Disable" : "Enable"}
                        </button>
                      ) : (
                        <button
                          className="row-action danger"
                          onClick={() => removeRecord(record.key)}
                        >
                          Delete
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** Cloud record keys render as "pk · sk" — convert back for DeleteItem. */
function parseDynamoKey(recordKey: string): Record<string, string> {
  const [pk, sk] = recordKey.split(" · ");
  return sk !== undefined ? { pk: pk ?? "", sk } : { pk: pk ?? "" };
}

export function RpcPlayground({ namespace, methods }: { namespace: string; methods: ApiMethod[] }) {
  const [selected, setSelected] = useState<ApiMethod | null>(null);
  const [argsText, setArgsText] = useState("[]");
  const [response, setResponse] = useState<RpcResponse | null>(null);
  const [argError, setArgError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function pick(method: ApiMethod) {
    setSelected(method);
    setResponse(null);
    setArgError(null);
    // Pre-fill a positional args skeleton from the source param names.
    setArgsText(
      method.params.length === 0
        ? "[]"
        : `[\n${method.params.map((name) => `  null /* ${name} */`).join(",\n")}\n]`,
    );
  }

  async function send() {
    if (!selected) return;
    let params: unknown[];
    try {
      // Strip the /* name */ hints before parsing.
      const cleaned = argsText.replace(/\/\*[^*]*\*\//g, "");
      params = JSON.parse(cleaned);
      if (!Array.isArray(params)) throw new Error("params must be a JSON array");
    } catch (error) {
      setArgError(error instanceof Error ? error.message : String(error));
      return;
    }
    setArgError(null);
    setBusy(true);
    try {
      setResponse(await callRpc(`${namespace}.${selected.name}`, params));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h3>RPC playground · local</h3>
      <div className="methods">
        {methods.map((method) => (
          <button
            key={method.name}
            className={`method-chip clickable ${selected?.name === method.name ? "selected" : ""}`}
            onClick={() => pick(method)}
          >
            {method.name}({method.params.join(", ")})
          </button>
        ))}
      </div>
      {selected && (
        <div className="playground">
          <label className="field-label" htmlFor="rpc-args">
            Positional params for <code>{namespace}.{selected.name}</code> (JSON array)
          </label>
          <textarea
            id="rpc-args"
            className="args-input"
            rows={Math.min(8, selected.params.length + 2)}
            value={argsText}
            onChange={(event) => setArgsText(event.target.value)}
            spellCheck={false}
          />
          {argError && <div className="error-banner">{argError}</div>}
          <button className="send-button" onClick={send} disabled={busy}>
            {busy ? "Calling…" : "Send"}
          </button>
          {response && (
            <>
              <div className="meta">
                HTTP {response.status} · {response.durationMs}ms
              </div>
              <div className="response-box">
                <JsonView value={response.body} />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
