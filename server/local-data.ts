import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
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
  /secret|token|password|hash|code|challenge|session|auth|credential/i;

/**
 * Content-based secret detection. Name-based redaction alone is a denylist:
 * it failed on the first unfamiliar project (a `<scope>-auth-users` store
 * shipped bcrypt hashes to the browser because no name token matched). These
 * patterns catch the value shapes themselves, so redaction fails safe no
 * matter what a project calls its stores.
 */
const SECRET_VALUE_PATTERNS: RegExp[] = [
  /\$2[aby]?\$\d{2}\$[./A-Za-z0-9]{53}/, // bcrypt
  /\$argon2[id]{1,2}\$/, // argon2
  /^\$?pbkdf2[-_$]/i, // pbkdf2
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./, // JWT
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/, // PEM private key
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/, // AWS access key id
];

function looksSecret(value: string): boolean {
  return SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value));
}

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
  let dir = resolve(bbDataRoot, fullId);
  if (!dir.startsWith(bbDataRoot + sep)) {
    return { ...empty, error: "invalid block id" };
  }
  if (!existsSync(dir)) {
    // Some blocks shard their state into sibling stores rather than one
    // directory named after the block (AuthBasic writes <fullId>-users and
    // <fullId>-codes). Fall back to the first sibling and name it in `source`.
    const siblings = existsSync(bbDataRoot)
      ? readdirSync(bbDataRoot)
          .filter((name) => name.startsWith(`${fullId}-`))
          .filter((name) => {
            // Skip siblings with no JSON payload (an unused -codes store),
            // otherwise the block reports "no JSON files" despite having data.
            const candidate = resolve(bbDataRoot, name);
            return (
              candidate.startsWith(bbDataRoot + sep) &&
              statSync(candidate).isDirectory() &&
              readdirSync(candidate).some((file) => file.endsWith(".json"))
            );
          })
          .sort()
      : [];
    const first = siblings[0];
    if (!first) {
      return { ...empty, error: `no local data at .bb-data/${fullId}` };
    }
    dir = resolve(bbDataRoot, first);
    if (!dir.startsWith(bbDataRoot + sep)) {
      return { ...empty, error: "invalid block id" };
    }
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
  let redactedAny = sensitive;
  const records = all.slice(0, MAX_RECORDS).map((record) => {
    // Redact when the store name looks sensitive OR the value itself carries a
    // credential shape — the content check is what makes this fail safe.
    const bySchema = sensitive || looksSecret(JSON.stringify(record.value) ?? "");
    if (bySchema) redactedAny = true;
    return {
      key: record.key,
      value: bySchema ? redact(record.value) : record.value,
    };
  });
  return {
    fullId,
    source: `.bb-data/${basename(dir)}/${preferred}`,
    records,
    totalRecords: all.length,
    redacted: redactedAny,
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
  if (typeof value === "string") {
    // Content check first: a 60-char bcrypt hash under an innocuous field
    // name would otherwise pass the length test and leak.
    if (looksSecret(value) || value.length > 120) return "•••redacted•••";
    return value;
  }
  if (value !== null && typeof value === "object") return redact(value);
  return value;
}
