import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import {
  AdminDisableUserCommand,
  AdminEnableUserCommand,
  CognitoIdentityProviderClient,
} from "@aws-sdk/client-cognito-identity-provider";
import {
  resolveBlockResources,
  type CloudClientOptions,
} from "./cloud-resources.js";
import { detectLocal } from "./detect.js";

export interface WriteResult {
  ok: boolean;
  message: string;
}

/** Delete one item from a block's primary DynamoDB table. Caller enforces unlock. */
export async function deleteCloudItem(
  stackName: string,
  blockFullId: string,
  key: Record<string, unknown>,
  options: CloudClientOptions,
): Promise<WriteResult> {
  const resources = await resolveBlockResources(stackName, blockFullId, options);
  const table = resources.tables[0];
  if (!table) return { ok: false, message: `no table mapped for ${blockFullId}` };
  if (typeof key.pk !== "string" || key.pk.length === 0) {
    return { ok: false, message: "key.pk (string) is required" };
  }
  const client = DynamoDBDocumentClient.from(new DynamoDBClient(options));
  await client.send(
    new DeleteCommand({
      TableName: table,
      Key: typeof key.sk === "string" ? { pk: key.pk, sk: key.sk } : { pk: key.pk },
      // Refuse to "succeed" on a no-op: the item must exist.
      ConditionExpression: "attribute_exists(pk)",
    }),
  );
  return { ok: true, message: `deleted from ${table}` };
}

/** Enable or disable a Cognito user. Caller enforces unlock. */
export async function setCloudUserEnabled(
  stackName: string,
  blockFullId: string,
  username: string,
  enabled: boolean,
  options: CloudClientOptions,
): Promise<WriteResult> {
  const resources = await resolveBlockResources(stackName, blockFullId, options);
  if (!resources.userPoolId) {
    return { ok: false, message: `no user pool mapped for ${blockFullId}` };
  }
  const client = new CognitoIdentityProviderClient(options);
  const input = { UserPoolId: resources.userPoolId, Username: username };
  await client.send(
    enabled ? new AdminEnableUserCommand(input) : new AdminDisableUserCommand(input),
  );
  return { ok: true, message: `${username} ${enabled ? "enabled" : "disabled"}` };
}

/**
 * Delete one record from a local .bb-data data.json store.
 *
 * The local mock loads data.json ONCE at dev-server start and flushes its
 * in-memory map on every write — editing the file under a running server
 * diverges silently and gets clobbered on the next flush. So this refuses
 * while the dev server is up.
 */
export async function deleteLocalRecord(
  projectPath: string,
  blockFullId: string,
  recordKey: string,
): Promise<WriteResult> {
  const local = await detectLocal(projectPath);
  if (local.serverUp) {
    return {
      ok: false,
      message:
        "local dev server is running — it caches this store in memory and would overwrite the change. Stop it (or mutate via the RPC playground) and retry.",
    };
  }
  const bbDataRoot = resolve(projectPath, ".bb-data");
  const dir = resolve(bbDataRoot, blockFullId);
  if (!dir.startsWith(bbDataRoot + sep)) return { ok: false, message: "invalid block id" };
  const filePath = join(dir, "data.json");
  if (!existsSync(filePath)) {
    return { ok: false, message: "only data.json stores support deletes" };
  }
  const entries: unknown = JSON.parse(readFileSync(filePath, "utf8"));
  if (!Array.isArray(entries)) return { ok: false, message: "unexpected store format" };
  const remaining = entries.filter(
    (entry) => !(Array.isArray(entry) && entry[0] === recordKey),
  );
  if (remaining.length === entries.length) {
    return { ok: false, message: `record not found: ${recordKey}` };
  }
  writeFileSync(filePath, JSON.stringify(remaining, null, 2));
  return { ok: true, message: `deleted ${recordKey} (takes effect now; store had ${entries.length}, now ${remaining.length})` };
}
