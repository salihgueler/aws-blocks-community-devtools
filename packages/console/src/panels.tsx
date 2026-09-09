import { useState } from "react";
import {
  callRpc,
  deleteCloudItem,
  deleteLocalRecord,
  putCloudItem,
  putLocalRecord,
  setCloudUserEnabled,
  useBlockData,
  type DataQuery,
} from "./api";
import { JsonView } from "./JsonView";
import { RecordEditor, emptyRecord } from "./RecordEditor";
import type { ApiMethod, KeySchema, RpcResponse, WriteMode } from "@aws-blocks-devtools/core";

/** Collapsed value preview: same syntax colors as the expanded tree. */
const SUMMARY_PAIRS = 3;
const SCALAR_CLAMP = 18;

function ValueSummary({ value }: { value: unknown }) {
  if (value === null || typeof value !== "object") {
    return <span className="value-summary"><Scalar value={value} /></span>;
  }
  if (Array.isArray(value)) {
    return (
      <span className="value-summary">
        <span className="json-punct">[ {value.length} item{value.length === 1 ? "" : "s"} ]</span>
      </span>
    );
  }
  const entries = Object.entries(value);
  // Bounded pair count plus flex-shrink clipping: overflow:hidden alone only
  // hides the paint, the text nodes still run under the actions column.
  const shown = entries.slice(0, SUMMARY_PAIRS);
  const hidden = entries.length - shown.length;
  return (
    <span className="value-summary">
      {shown.map(([key, field]) => (
        <span key={key} className="summary-pair">
          <span className="json-key">{key}</span>
          <span className="json-punct">:</span>
          <SummaryValue value={field} />
        </span>
      ))}
      {hidden > 0 ? <span className="json-count">+{hidden}</span> : null}
    </span>
  );
}

function SummaryValue({ value }: { value: unknown }) {
  if (value !== null && typeof value === "object") {
    return (
      <span className="json-punct">
        {Array.isArray(value) ? `[${value.length}]` : "{…}"}
      </span>
    );
  }
  return <Scalar value={value} clamp />;
}

function Scalar({ value, clamp = false }: { value: unknown; clamp?: boolean }) {
  if (value === null) return <span className="json-null">null</span>;
  switch (typeof value) {
    case "string": {
      const text = clamp && value.length > SCALAR_CLAMP ? `${value.slice(0, SCALAR_CLAMP)}…` : value;
      return <span className="json-str">"{text}"</span>;
    }
    case "number":
      return <span className="json-num">{String(value)}</span>;
    case "boolean":
      return <span className="json-bool">{String(value)}</span>;
    default:
      return <span className="json-null">{String(value)}</span>;
  }
}

/**
 * Record keys arrive as the store's serialized form — local:
 * '["SLUG","alice-…"]', cloud: 'SLUG · alice-…'. Render both as
 * labeled colored segments instead of raw serialization.
 */
function KeyCell({ recordKey }: { recordKey: string }) {
  let parts: string[] | null = null;
  if (recordKey.startsWith("[")) {
    try {
      const parsed = JSON.parse(recordKey);
      // Numeric sort keys are common (timestamps), so accept numbers too.
      if (
        Array.isArray(parsed) &&
        parsed.every((p) => typeof p === "string" || typeof p === "number")
      ) {
        parts = parsed.map(String);
      }
    } catch {
      parts = null;
    }
  } else if (recordKey.includes(" · ")) {
    parts = recordKey.split(" · ");
  }
  if (!parts) return <span className="key-plain">{recordKey}</span>;
  return (
    <span className="key-parts">
      {parts.map((part, index) => (
        <span key={index} className={`key-part ${index === 0 ? "pk" : "sk"}`}>
          {part}
        </span>
      ))}
    </span>
  );
}

export function DataBrowser({
  fullId,
  query,
  blockType,
  unlocked,
  keySchema,
}: {
  fullId: string;
  query: DataQuery;
  blockType: string;
  unlocked: boolean;
  keySchema: KeySchema | undefined;
}) {
  const [refreshKey, setRefreshKey] = useState(0);
  const [store, setStore] = useState<string | undefined>(undefined);
  const { data, error, loading } = useBlockData(
    fullId,
    { ...query, ...(store ? { store } : {}) },
    refreshKey,
  );
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editor, setEditor] = useState<
    { mode: WriteMode; initial: unknown } | null
  >(null);
  const [saving, setSaving] = useState(false);
  const isCloud = query.env === "cloud";
  const isCognito = isCloud && blockType.startsWith("Auth");
  const canWrite = isCloud ? unlocked : true;
  const isTable = blockType === "DistributedTable";
  const title = isCloud ? "Cloud data · read-only unless unlocked" : "Local data";

  async function saveRecord(item: Record<string, unknown>) {
    if (!editor) return;
    if (
      isCloud &&
      !window.confirm(`${editor.mode === "create" ? "Create" : "Overwrite"} this record in PRODUCTION?`)
    )
      return;
    setSaving(true);
    try {
      const result = isCloud
        ? await putCloudItem(query.stack ?? "", fullId, item, editor.mode)
        : await putLocalRecord(fullId, item, editor.mode);
      setNotice(result.message);
      if (result.ok) {
        setEditor(null);
        setRefreshKey((k) => k + 1);
      }
    } finally {
      setSaving(false);
    }
  }

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
      <div className="card-head">
        <h3>
          {title} · {data.source} · {data.totalRecords} record{data.totalRecords === 1 ? "" : "s"}
          {data.redacted ? " · secrets redacted" : ""}
        </h3>
        {canWrite && isTable && !editor ? (
          <button
            className="row-action"
            onClick={() => setEditor({ mode: "create", initial: emptyRecord(keySchema) })}
          >
            + New record
          </button>
        ) : null}
      </div>
      {data.stores.length > 1 ? (
        <div className="store-picker" role="group" aria-label="Store">
          {data.stores.map((name) => (
            <button
              key={name}
              className={`row-action ${name === data.activeStore ? "selected" : ""}`}
              onClick={() => setStore(name)}
            >
              {name}
            </button>
          ))}
        </div>
      ) : null}
      {notice ? <div className="notice">{notice}</div> : null}
      {editor ? (
        <RecordEditor
          mode={editor.mode}
          keySchema={keySchema}
          initialValue={editor.initial}
          busy={saving}
          onSave={saveRecord}
          onCancel={() => setEditor(null)}
        />
      ) : null}
      {data.records.length === 0 ? (
        <div className="empty">Store is empty.</div>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Key</th>
              <th scope="col">Value</th>
              {canWrite ? <th scope="col">Actions</th> : null}
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
                  <td className="key-cell"><KeyCell recordKey={record.key} /></td>
                  <td>
                    {expanded ? (
                      <div>
                        <button
                          className="collapse-link"
                          onClick={() => setExpandedKey(null)}
                          aria-expanded={true}
                        >
                          ▾ collapse
                        </button>
                        <JsonView value={record.value} />
                      </div>
                    ) : (
                      <button
                        className="value-toggle"
                        onClick={() => setExpandedKey(record.key)}
                        aria-expanded={false}
                      >
                        <ValueSummary value={record.value} />
                      </button>
                    )}
                  </td>
                  {canWrite ? (
                    <td className="actions-cell">
                      {isCognito ? (
                        <button
                          className="row-action"
                          onClick={() => toggleUser(record.key, !userEnabled)}
                        >
                          {userEnabled ? "Disable" : "Enable"}
                        </button>
                      ) : (
                        <>
                          {isTable && !data.redacted ? (
                            <button
                              className="row-action"
                              onClick={() =>
                                setEditor({ mode: "edit", initial: record.value })
                              }
                            >
                              Edit
                            </button>
                          ) : null}
                          <button
                            className="row-action danger"
                            onClick={() => removeRecord(record.key)}
                          >
                            Delete
                          </button>
                        </>
                      )}
                    </td>
                  ) : null}
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

export function RpcPlayground({
  namespace,
  methods,
  env,
}: {
  namespace: string;
  methods: ApiMethod[];
  env: "local" | "cloud";
}) {
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
      setResponse(await callRpc(`${namespace}.${selected.name}`, params, env));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h3>RPC playground · {env === "cloud" ? "deployed API" : "local dev server"}</h3>
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
      {selected ? (
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
          {argError ? <div className="error-banner">{argError}</div> : null}
          <button className="send-button" onClick={send} disabled={busy}>
            {busy ? "Calling…" : "Send"}
          </button>
          {response ? (
            <>
              <div className="meta">
                HTTP {response.status} · {response.durationMs}ms
              </div>
              <div className="response-box">
                <JsonView value={response.body} />
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
