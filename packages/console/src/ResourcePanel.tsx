import { useState } from "react";
import { useResources } from "./api";

/**
 * Deployed AWS resources, grouped by the block that created them.
 *
 * Console links inherit whichever account the browser is signed into — that
 * cannot be forced from a URL — so the account and region are stated in the
 * header, making a mismatch visible instead of mysterious.
 */
export function ResourcePanel() {
  const { data, error, loading } = useResources();
  const [open, setOpen] = useState<Record<string, boolean>>({});

  if (loading) {
    return (
      <div className="card">
        <h2 className="card-heading">Deployed resources</h2>
        <div className="empty">Reading the stack…</div>
      </div>
    );
  }
  const problem = error ?? data?.error;
  if (problem || !data) {
    return (
      <div className="card">
        <h2 className="card-heading">Deployed resources</h2>
        <div className="empty">{problem ?? "no data"}</div>
      </div>
    );
  }

  return (
    <div>
      <div className="detail-head">
        <div>
          <h2>Deployed resources</h2>
          <div className="meta">
            {data.total} resources · {data.stackName} · account {data.accountId ?? "?"} ·{" "}
            {data.region}
          </div>
        </div>
      </div>

      <div className="notice">
        Links open in whichever AWS account your browser is signed into. This stack is
        in account <strong>{data.accountId ?? "unknown"}</strong> ({data.region}) — if a
        link looks wrong, check which account you are logged into.{" "}
        <a className="stack-link" href={data.stackUrl} target="_blank" rel="noreferrer">
          Open the whole stack →
        </a>
      </div>

      {data.groups.map((group) => {
        const key = group.blockFullId ?? `${group.kind}:${group.label}`;
        // Block groups start open (few, and the interesting ones). Feature and
        // service groups start closed so 30 rows do not bury everything.
        const expanded = open[key] ?? group.kind === "block";
        return (
          <div className="card resource-group" key={key}>
            <button
              className="group-toggle"
              onClick={() => setOpen((prev) => ({ ...prev, [key]: !expanded }))}
              aria-expanded={expanded}
            >
              <span className="json-caret">{expanded ? "▾" : "▸"}</span>
              <span className="group-label">{group.label}</span>
              <span className="group-count">
                {group.resources.length} resource{group.resources.length === 1 ? "" : "s"}
              </span>
              {group.kind !== "block" ? (
                <span className={`group-tag group-tag-${group.kind}`}>{group.kind}</span>
              ) : null}
            </button>
            {expanded && group.note ? <p className="group-note">{group.note}</p> : null}
            {expanded ? (
              <table className="data-table resource-table">
                <thead>
                  <tr>
                    <th scope="col">Type</th>
                    <th scope="col">Resource</th>
                    <th scope="col">Open</th>
                  </tr>
                </thead>
                <tbody>
                  {group.resources.map((resource) => (
                    <tr key={resource.logicalId}>
                      <td className="res-type">{resource.typeLabel}</td>
                      <td className="res-id">
                        <span className="res-physical">
                          {resource.physicalId || resource.logicalId}
                        </span>
                        <span className="res-logical">{resource.logicalId}</span>
                      </td>
                      <td className="actions-cell">
                        <a
                          className={`row-action ${resource.directLink ? "" : "indirect"}`}
                          href={resource.consoleUrl}
                          target="_blank"
                          rel="noreferrer"
                          title={
                            resource.directLink
                              ? "Open in the AWS console"
                              : "No direct console page for this type — opens the stack instead"
                          }
                        >
                          {resource.directLink ? "Console" : "Stack"}
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
