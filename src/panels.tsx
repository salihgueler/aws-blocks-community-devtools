import { useState } from "react";
import { callRpc, useBlockData } from "./api";
import type { ApiMethod, RpcResponse } from "../shared/types";

export function DataBrowser({ fullId }: { fullId: string }) {
  const { data, error, loading } = useBlockData(fullId);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  if (loading) return <div className="card"><h3>Local data</h3><div className="empty">Loading…</div></div>;
  const problem = error ?? data?.error;
  if (problem || !data) {
    return <div className="card"><h3>Local data</h3><div className="empty">{problem ?? "no data"}</div></div>;
  }
  return (
    <div className="card">
      <h3>
        Local data · {data.source} · {data.totalRecords} record{data.totalRecords === 1 ? "" : "s"}
        {data.redacted ? " · secrets redacted" : ""}
      </h3>
      {data.records.length === 0 ? (
        <div className="empty">Store is empty.</div>
      ) : (
        <table className="data-table">
          <thead>
            <tr><th scope="col">Key</th><th scope="col">Value</th></tr>
          </thead>
          <tbody>
            {data.records.map((record) => {
              const expanded = expandedKey === record.key;
              const text = JSON.stringify(record.value, null, expanded ? 2 : 0) ?? "";
              return (
                <tr key={record.key}>
                  <td className="key-cell">{record.key}</td>
                  <td>
                    <button
                      className="value-toggle"
                      onClick={() => setExpandedKey(expanded ? null : record.key)}
                      aria-expanded={expanded}
                    >
                      <pre className={`code value ${expanded ? "" : "clamp"}`}>{text}</pre>
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
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
              <pre className="code">{JSON.stringify(response.body, null, 2)}</pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}
