import type { KeySchema } from "@aws-blocks-devtools/core";

/**
 * Validation for record writes — the single place both local and cloud put
 * paths call before touching any store. Fails with a precise message
 * naming the field, never a bare "invalid".
 */

const MAX_RECORD_BYTES = 100 * 1024; // well under DynamoDB's 400KB item cap
const MAX_KEY_CHARS = 1024;

export class ValidationError extends Error {}

export function validateRecord(
  item: unknown,
  keySchema: KeySchema,
): asserts item is Record<string, unknown> {
  if (item === null || typeof item !== "object" || Array.isArray(item)) {
    throw new ValidationError("record must be a JSON object");
  }
  const record = item as Record<string, unknown>;

  for (const keyField of keyFields(keySchema)) {
    const value = record[keyField];
    if (typeof value !== "string" || value.length === 0) {
      throw new ValidationError(
        `key field "${keyField}" must be a non-empty string`,
      );
    }
    if (value.length > MAX_KEY_CHARS) {
      throw new ValidationError(
        `key field "${keyField}" exceeds ${MAX_KEY_CHARS} characters`,
      );
    }
  }

  const bytes = Buffer.byteLength(JSON.stringify(record), "utf8");
  if (bytes > MAX_RECORD_BYTES) {
    throw new ValidationError(
      `record is ${bytes} bytes; cap is ${MAX_RECORD_BYTES}`,
    );
  }
  assertJsonSafe(record, "record");
}

export function keyFields(keySchema: KeySchema): string[] {
  return keySchema.sortKey
    ? [keySchema.partitionKey, keySchema.sortKey]
    : [keySchema.partitionKey];
}

export function keyOf(
  record: Record<string, unknown>,
  keySchema: KeySchema,
): Record<string, string> {
  const key: Record<string, string> = {};
  for (const field of keyFields(keySchema)) {
    key[field] = String(record[field]);
  }
  return key;
}

/** Reject values JSON.parse can never produce (guards non-HTTP callers). */
function assertJsonSafe(value: unknown, path: string): void {
  if (value === null) return;
  switch (typeof value) {
    case "string":
    case "boolean":
      return;
    case "number":
      if (!Number.isFinite(value)) {
        throw new ValidationError(`${path} must be a finite number`);
      }
      return;
    case "object":
      break;
    default:
      throw new ValidationError(`${path} has unsupported type ${typeof value}`);
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertJsonSafe(entry, `${path}[${index}]`));
    return;
  }
  for (const [key, field] of Object.entries(value)) {
    assertJsonSafe(field, `${path}.${key}`);
  }
}
