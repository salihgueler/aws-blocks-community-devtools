import { useState, type ReactNode } from "react";

/**
 * Collapsible JSON tree. Every object/array node has its own ▾/▸ toggle;
 * collapsed nodes summarize as `{…} 5 keys` / `[…] 3 items`. Nodes deeper
 * than DEFAULT_OPEN_DEPTH start collapsed so large records stay scannable.
 */

const DEFAULT_OPEN_DEPTH = 2;

export function JsonView({ value }: { value: unknown }) {
  return (
    <div className="json-view">
      <Node value={value} depth={0} />
    </div>
  );
}

function Node({ value, depth }: { value: unknown; depth: number }): ReactNode {
  if (value === null) return <span className="json-null">null</span>;
  switch (typeof value) {
    case "string":
      return <span className="json-str">"{value}"</span>;
    case "number":
      return <span className="json-num">{String(value)}</span>;
    case "boolean":
      return <span className="json-bool">{String(value)}</span>;
    case "undefined":
      return <span className="json-null">undefined</span>;
  }
  if (Array.isArray(value)) {
    return (
      <Branch
        depth={depth}
        count={value.length}
        kind="array"
        entries={value.map((item, index) => [String(index), item, false])}
      />
    );
  }
  const entries = Object.entries(value as Record<string, unknown>);
  return (
    <Branch
      depth={depth}
      count={entries.length}
      kind="object"
      entries={entries.map(([key, field]) => [key, field, true])}
    />
  );
}

function Branch({
  depth,
  count,
  kind,
  entries,
}: {
  depth: number;
  count: number;
  kind: "object" | "array";
  entries: [string, unknown, boolean][];
}) {
  const [open, setOpen] = useState(depth < DEFAULT_OPEN_DEPTH);
  const [openBracket, closeBracket] = kind === "array" ? ["[", "]"] : ["{", "}"];
  const summary =
    kind === "array"
      ? `${count} item${count === 1 ? "" : "s"}`
      : `${count} key${count === 1 ? "" : "s"}`;

  if (count === 0) {
    return <span className="json-punct">{openBracket}{closeBracket}</span>;
  }
  if (!open) {
    return (
      <button
        className="json-toggle"
        onClick={() => setOpen(true)}
        aria-expanded={false}
        aria-label={`expand ${summary}`}
      >
        <span className="json-caret">▸</span>
        <span className="json-punct">{openBracket}…{closeBracket}</span>
        <span className="json-count">{summary}</span>
      </button>
    );
  }
  return (
    <>
      <button
        className="json-toggle"
        onClick={() => setOpen(false)}
        aria-expanded={true}
        aria-label={`collapse ${summary}`}
      >
        <span className="json-caret">▾</span>
        <span className="json-punct">{openBracket}</span>
      </button>
      {entries.map(([key, field, showKey], index) => (
        <div key={key} className="json-row">
          {showKey && (
            <>
              <span className="json-key">{key}</span>
              <span className="json-punct">: </span>
            </>
          )}
          <Node value={field} depth={depth + 1} />
          {index < entries.length - 1 && <span className="json-punct">,</span>}
        </div>
      ))}
      <span className="json-punct">{closeBracket}</span>
    </>
  );
}
