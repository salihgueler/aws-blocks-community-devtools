import { useMemo, useState } from "react";
import type { KeySchema, WriteMode } from "../shared/types";

/**
 * JSON record editor for create/edit. Validates as you type — parse errors
 * and key-field problems disable Save with a named reason, mirroring the
 * server-side checks (the server re-validates regardless).
 */

export function RecordEditor({
  mode,
  keySchema,
  initialValue,
  busy,
  onSave,
  onCancel,
}: {
  mode: WriteMode;
  keySchema: KeySchema | undefined;
  initialValue: unknown;
  busy: boolean;
  onSave: (item: Record<string, unknown>) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(() => JSON.stringify(initialValue, null, 2));

  const problem = useMemo(() => validate(text, keySchema), [text, keySchema]);

  return (
    <div className="editor">
      <label className="field-label" htmlFor="record-editor">
        {mode === "create" ? "New record" : "Edit record"} (JSON object
        {keySchema
          ? `; key fields: ${keySchema.partitionKey}${keySchema.sortKey ? `, ${keySchema.sortKey}` : ""}`
          : ""}
        )
      </label>
      <textarea
        id="record-editor"
        className="args-input editor-input"
        rows={Math.min(16, text.split("\n").length + 1)}
        value={text}
        onChange={(event) => setText(event.target.value)}
        spellCheck={false}
      />
      {problem && <div className="editor-problem" role="alert">{problem}</div>}
      <div className="editor-actions">
        <button
          className="send-button"
          disabled={busy || problem !== null}
          onClick={() => onSave(JSON.parse(text) as Record<string, unknown>)}
        >
          {busy ? "Saving…" : mode === "create" ? "Create" : "Save changes"}
        </button>
        <button className="row-action" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function validate(text: string, keySchema: KeySchema | undefined): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return error instanceof Error ? error.message : "invalid JSON";
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return "record must be a JSON object";
  }
  if (keySchema) {
    const record = parsed as Record<string, unknown>;
    const fields = keySchema.sortKey
      ? [keySchema.partitionKey, keySchema.sortKey]
      : [keySchema.partitionKey];
    for (const field of fields) {
      const value = record[field];
      if (typeof value !== "string" || value.length === 0) {
        return `key field "${field}" must be a non-empty string`;
      }
    }
  }
  return null;
}

/** Skeleton for a fresh record: key fields first, empty strings. */
export function emptyRecord(keySchema: KeySchema | undefined): Record<string, string> {
  if (!keySchema) return {};
  return keySchema.sortKey
    ? { [keySchema.partitionKey]: "", [keySchema.sortKey]: "" }
    : { [keySchema.partitionKey]: "" };
}
