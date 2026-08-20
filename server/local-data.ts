import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join, resolve, sep } from "node:path";
import type { BlockDataPage, DataRecord } from "../shared/types.js";

/**
 * Reads a block's local mock state from .bb-data/<fullId>/.
 *
 * Observed formats (verified against a real project):
 * - DistributedTable/KVStore `data.json`: array of [serializedKey, item] pairs
 * - Session/KV `store.json`: object of key -> { value: string }
 * - Auth `state.json`: { users, groups, codes, challenges, sessionSecret }
 *
 * Auth-shaped stores carry secrets (session signing secret, tokens, password
 * hashes) — those values are redacted before leaving the backend.
 */

const MAX_RECORDS = 500;
const SECRET_KEY_PATTERN =
  /secret|token|password|hash|code|challenge|session/i;

export function readBlockData(projectPath: string, fullId: string): BlockDataPage {
  const empty: BlockDataPage = {
    fullId,
    source: "",
    records: [],
    totalRecords: 0,
    redacted: false,
    error: null,
  };
  // fullId comes from the URL — refuse anything that could escape .bb-data/.
  const bbDataRoot = resolve(projectPath, ".bb-data");
  const dir = resolve(bbDataRoot, fullId);
  if (!dir.startsWith(bbDataRoot + sep)) {
    return { ...empty, error: "invalid block id" };
  }
  if (!existsSync(dir)) {
    return { ...empty, error: `no local data at .bb-data/${fullId}` };
  }

  const files = readdirSync(dir).filter((name) => name.endsWith(".json"));
  const preferred =
    files.find((name) => name === "data.json") ??
    files.find((name) => name === "store.json") ??
    files.find((name) => name === "state.json") ??
    files[0];
  if (!preferred) return { ...empty, error: "no JSON files in store" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(join(dir, preferred), "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ...empty, source: preferred, error: `unparseable: ${message}` };
  }

  const sensitive = SECRET_KEY_PATTERN.test(fullId) || preferred === "state.json";
  const all = normalize(parsed);
  const records = all.slice(0, MAX_RECORDS).map((record) => ({
    key: record.key,
    value: sensitive ? redact(record.value) : record.value,
  }));
  return {
    fullId,
    source: `.bb-data/${basename(dir)}/${preferred}`,
    records,
    totalRecords: all.length,
    redacted: sensitive,
    error: null,
  };
}

function normalize(parsed: unknown): DataRecord[] {
  // Format A: [ [key, item], ... ]
  if (Array.isArray(parsed)) {
    return parsed.map((entry, index) => {
      if (Array.isArray(entry) && entry.length === 2 && typeof entry[0] === "string") {
        return { key: entry[0], value: unwrapNestedJson(entry[1]) };
      }
      return { key: String(index), value: entry };
    });
  }
  // Format B: { key: value, ... }
  if (parsed !== null && typeof parsed === "object") {
    return Object.entries(parsed).map(([key, value]) => ({
      key,
      value: unwrapNestedJson(value),
    }));
  }
  return [{ key: "value", value: parsed }];
}

/** Items often hold JSON-in-strings (e.g. a `page` field). Unwrap one level for display. */
function unwrapNestedJson(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(value)) {
    if (typeof field === "string" && (field.startsWith("{") || field.startsWith("["))) {
      try {
        output[key] = JSON.parse(field);
        continue;
      } catch {
        // fall through — keep the raw string
      }
    }
    output[key] = field;
  }
  return output;
}

function redact(value: unknown): unknown {
  if (typeof value === "string") return "•••redacted•••";
  if (Array.isArray(value)) return value.map(redact);
  if (value !== null && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, field] of Object.entries(value)) {
      output[key] = SECRET_KEY_PATTERN.test(key) ? "•••redacted•••" : redactShallow(field);
    }
    return output;
  }
  return value;
}

/** Keep non-secret scalar fields readable (usernames, emails, timestamps). */
function redactShallow(value: unknown): unknown {
  if (typeof value === "string" && value.length > 120) return "•••redacted•••";
  if (value !== null && typeof value === "object") return redact(value);
  return value;
}
