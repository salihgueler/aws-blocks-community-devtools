import type { ReactNode } from "react";

/**
 * Human-readable JSON: real indentation, syntax coloring, and stable key
 * order as delivered. Renders with the project's data palette — mono is
 * earned here (this IS data), per the design system.
 */

const INDENT = 16;

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
    if (value.length === 0) return <span className="json-punct">[]</span>;
    return (
      <>
        <span className="json-punct">[</span>
        {value.map((item, index) => (
          <div key={index} style={{ paddingLeft: INDENT }}>
            <Node value={item} depth={depth + 1} />
            {index < value.length - 1 && <span className="json-punct">,</span>}
          </div>
        ))}
        <span className="json-punct">]</span>
      </>
    );
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return <span className="json-punct">{"{}"}</span>;
  return (
    <>
      <span className="json-punct">{"{"}</span>
      {entries.map(([key, field], index) => (
        <div key={key} style={{ paddingLeft: INDENT }}>
          <span className="json-key">{key}</span>
          <span className="json-punct">: </span>
          <Node value={field} depth={depth + 1} />
          {index < entries.length - 1 && <span className="json-punct">,</span>}
        </div>
      ))}
      <span className="json-punct">{"}"}</span>
    </>
  );
}
