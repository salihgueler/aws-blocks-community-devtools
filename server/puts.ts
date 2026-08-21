import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { DescribeTableCommand, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import type { KeySchema, WriteMode } from "../shared/types.js";
import {
  resolveBlockResources,
  type CloudClientOptions,
} from "./cloud-resources.js";
import { detectLocal } from "./detect.js";
import { keyFields, keyOf, validateRecord, ValidationError } from "./validate.js";
import type { WriteResult } from "./writes.js";

/**
 * Create/edit for DynamoDB-backed and local .bb-data stores.
 *
 * Mode semantics are enforced with conditions, not hope:
 * - create: refuses if an item with the same key already exists
 * - edit:   refuses if the item does not exist (no silent upsert)
 *
 * Cloud key schema comes from DescribeTable (ground truth), not the AST.
 */

export async function putCloudItem(
  stackName: string,
  blockFullId: string,
  item: unknown,
  mode: WriteMode,
  options: CloudClientOptions,
): Promise<WriteResult> {
  const resources = await resolveBlockResources(stackName, blockFullId, options);
  const table = resources.tables[0];
  if (!table) return { ok: false, message: `no table mapped for ${blockFullId}` };

  const client = DynamoDBDocumentClient.from(new DynamoDBClient(options));
  const description = await client.send(
    new DescribeTableCommand({ TableName: table }),
  );
  const keySchema = toKeySchema(description.Table?.KeySchema);
  if (!keySchema) return { ok: false, message: `cannot read key schema of ${table}` };

  try {
    validateRecord(item, keySchema);
  } catch (error) {
    if (error instanceof ValidationError) return { ok: false, message: error.message };
    throw error;
  }
  const fields = keyFields(keySchema);
  const condition =
    mode === "create"
      ? fields.map((f) => `attribute_not_exists(#${f})`).join(" AND ")
      : fields.map((f) => `attribute_exists(#${f})`).join(" AND ");
  try {
    await client.send(
      new PutCommand({
        TableName: table,
        Item: item,
        ConditionExpression: condition,
        ExpressionAttributeNames: Object.fromEntries(fields.map((f) => [`#${f}`, f])),
      }),
    );
  } catch (error) {
    if (error instanceof Error && error.name === "ConditionalCheckFailedException") {
      return {
        ok: false,
        message:
          mode === "create"
            ? "a record with this key already exists (use edit)"
            : "no record with this key exists (use create)",
      };
    }
    throw error;
  }
  return { ok: true, message: `${mode === "create" ? "created" : "updated"} in ${table}` };
}

function toKeySchema(
  elements: { AttributeName?: string; KeyType?: string }[] | undefined,
): KeySchema | null {
  const partition = elements?.find((e) => e.KeyType === "HASH")?.AttributeName;
  if (!partition) return null;
  const sort = elements?.find((e) => e.KeyType === "RANGE")?.AttributeName;
  return sort ? { partitionKey: partition, sortKey: sort } : { partitionKey: partition };
}

/**
 * Local store put. Mirrors the mock's on-disk shape exactly:
 * data.json is [ [serializedKey, item], ... ] with
 * serializedKey = JSON.stringify([pkValue, skValue?]).
 * Same dev-server-down guard as deletes (mock caches in memory).
 */
export async function putLocalRecord(
  projectPath: string,
  blockFullId: string,
  item: unknown,
  mode: WriteMode,
  keySchema: KeySchema | undefined,
): Promise<WriteResult> {
  if (!keySchema) {
    return { ok: false, message: "no key schema discovered for this block" };
  }
  const local = await detectLocal(projectPath);
  if (local.serverUp) {
    return {
      ok: false,
      message:
        "local dev server is running — it caches this store in memory and would overwrite the change. Stop it and retry.",
    };
  }
  try {
    validateRecord(item, keySchema);
  } catch (error) {
    if (error instanceof ValidationError) return { ok: false, message: error.message };
    throw error;
  }
  const bbDataRoot = resolve(projectPath, ".bb-data");
  const dir = resolve(bbDataRoot, blockFullId);
  if (!dir.startsWith(bbDataRoot + sep)) return { ok: false, message: "invalid block id" };
  const filePath = join(dir, "data.json");
  if (!existsSync(filePath)) {
    return { ok: false, message: "only data.json stores support writes" };
  }
  const entries: unknown = JSON.parse(readFileSync(filePath, "utf8"));
  if (!Array.isArray(entries)) return { ok: false, message: "unexpected store format" };

  const key = keyOf(item, keySchema);
  const serializedKey = JSON.stringify(keyFields(keySchema).map((f) => key[f]));
  const index = entries.findIndex(
    (entry) => Array.isArray(entry) && entry[0] === serializedKey,
  );
  if (mode === "create" && index !== -1) {
    return { ok: false, message: "a record with this key already exists (use edit)" };
  }
  if (mode === "edit" && index === -1) {
    return { ok: false, message: "no record with this key exists (use create)" };
  }
  if (index === -1) entries.push([serializedKey, item]);
  else entries[index] = [serializedKey, item];
  writeFileSync(filePath, JSON.stringify(entries, null, 2));
  return {
    ok: true,
    message: `${mode === "create" ? "created" : "updated"} ${serializedKey} (store now ${entries.length} records)`,
  };
}
