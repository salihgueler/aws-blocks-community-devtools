import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, resolve, sep } from "node:path";
import type { BlockDataPage, DataRecord } from "../shared/types.js";
import { SECRET_KEY_PATTERN, looksSecret, orderStores, redactValue } from "./redact.js";

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

export function readBlockData(
  projectPath: string,
  fullId: string,
  store?: string,
): BlockDataPage {
  const empty: BlockDataPage = {
    fullId,
    source: "",
    records: [],
    totalRecords: 0,
    redacted: false,
    error: null,
    stores: [],
    activeStore: null,
  };
  const bbDataRoot = resolve(projectPath, ".bb-data");
  // fullId comes from the URL — refuse anything that could escape .bb-data/.
  const exact = resolve(bbDataRoot, fullId);
  if (!exact.startsWith(bbDataRoot + sep)) {
    return { ...empty, error: "invalid block id" };
  }

  // A block may own several stores: its own directory and/or siblings, since
  // some blocks shard state (AuthBasic writes <fullId>-users and -codes).
  const stores: string[] = [];
  if (existsSync(exact) && hasJson(exact)) stores.push(fullId);
  if (existsSync(bbDataRoot)) {
    for (const name of readdirSync(bbDataRoot).sort()) {
      if (name === fullId || !name.startsWith(`${fullId}-`)) continue;
      const candidate = resolve(bbDataRoot, name);
      if (candidate.startsWith(bbDataRoot + sep) && hasJson(candidate)) {
        stores.push(name);
      }
    }
  }
  empty.stores = orderStores(stores);

  const selected =
    store && empty.stores.includes(store) ? store : empty.stores[0];
  if (!selected) {
    return { ...empty, error: `no local data at .bb-data/${fullId}` };
  }
  const dir = resolve(bbDataRoot, selected);
  if (!dir.startsWith(bbDataRoot + sep)) {
    return { ...empty, error: "invalid store" };
  }
  empty.activeStore = selected;

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
  let redactedAny = sensitive;
  const records = all.slice(0, MAX_RECORDS).map((record) => {
    // Redact when the store name looks sensitive OR the value itself carries a
    // credential shape — the content check is what makes this fail safe.
    const bySchema = sensitive || looksSecret(JSON.stringify(record.value) ?? "");
    if (bySchema) redactedAny = true;
    return {
      key: record.key,
      value: bySchema ? redactValue(record.value) : record.value,
    };
  });
  return {
    fullId,
    source: `.bb-data/${basename(dir)}/${preferred}`,
    records,
    totalRecords: all.length,
    redacted: redactedAny,
    error: null,
    stores: empty.stores,
    activeStore: empty.activeStore,
  };
}

/** A store directory is only usable if it actually holds a JSON payload. */
function hasJson(dir: string): boolean {
  try {
    return (
      statSync(dir).isDirectory() &&
      readdirSync(dir).some((file) => file.endsWith(".json"))
    );
  } catch {
    return false;
  }
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

