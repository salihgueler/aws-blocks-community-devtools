import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";
import {
  CognitoIdentityProviderClient,
  ListUsersCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import type { BlockDataPage, DataRecord } from "../shared/types.js";
import { looksSecret, redactValue } from "./redact.js";
import {
  resolveBlockResources,
  type CloudClientOptions,
} from "./cloud-resources.js";

/**
 * Read-only cloud browsers. Every call here is a Get/List/Scan — no write
 * APIs are imported in this module, which is the enforcement seam for the
 * "cloud is read-only" guarantee until an explicit unlock feature exists.
 */

const SCAN_LIMIT = 100;
const SESSION_TABLE_PATTERN = /session|token|secret/i;

export async function readCloudBlockData(
  stackName: string,
  blockFullId: string,
  blockType: string,
  options: CloudClientOptions,
  store?: string,
): Promise<BlockDataPage> {
  const base: BlockDataPage = {
    fullId: blockFullId,
    source: "",
    records: [],
    totalRecords: 0,
    redacted: false,
    error: null,
    stores: [],
    activeStore: null,
  };
  try {
    const resources = await resolveBlockResources(stackName, blockFullId, options);
    // A block can map to several physical stores (a table plus a sessions
    // table, a user pool plus its client) — expose them all, not just [0].
    base.stores = blockType.startsWith("Auth")
      ? [...(resources.userPoolId ? [resources.userPoolId] : []), ...resources.tables]
      : [...resources.tables, ...(resources.userPoolId ? [resources.userPoolId] : [])];
    const selected =
      store && base.stores.includes(store) ? store : base.stores[0];
    base.activeStore = selected ?? null;
    if (selected && selected === resources.userPoolId) {
      return await readCognitoUsers(resources.userPoolId, options, base);
    }
    if (selected) return await scanTable(selected, options, base);
    base.error = `no readable cloud resource mapped for ${blockFullId}`;
  } catch (error) {
    base.error = error instanceof Error ? error.message : String(error);
  }
  return base;
}

async function scanTable(
  tableName: string,
  options: CloudClientOptions,
  base: BlockDataPage,
): Promise<BlockDataPage> {
  const client = DynamoDBDocumentClient.from(new DynamoDBClient(options));
  const page = await client.send(
    new ScanCommand({ TableName: tableName, Limit: SCAN_LIMIT }),
  );
  const sensitiveTable = SESSION_TABLE_PATTERN.test(tableName);
  let redactedAny = sensitiveTable;
  const records: DataRecord[] = (page.Items ?? []).map((item, index) => {
    const key = [item.pk, item.sk].filter(Boolean).join(" · ") || String(index);
    // Same boundary rule as the local reader: the table name is a hint, the
    // value shape is the authority. A store nobody thought to name
    // "sessions" still must not ship credentials to the browser.
    const sensitive = sensitiveTable || looksSecret(JSON.stringify(item) ?? "");
    if (sensitive) redactedAny = true;
    return { key, value: sensitive ? redactValue(item) : item };
  });
  return {
    ...base,
    source: `dynamodb:${tableName}${page.LastEvaluatedKey ? ` (first ${SCAN_LIMIT})` : ""}`,
    records,
    totalRecords: page.Count ?? records.length,
    redacted: redactedAny,
  };
}

async function readCognitoUsers(
  userPoolId: string,
  options: CloudClientOptions,
  base: BlockDataPage,
): Promise<BlockDataPage> {
  const client = new CognitoIdentityProviderClient(options);
  const page = await client.send(
    new ListUsersCommand({ UserPoolId: userPoolId, Limit: 60 }),
  );
  const records: DataRecord[] = (page.Users ?? []).map((user) => ({
    key: user.Username ?? "unknown",
    value: {
      status: user.UserStatus,
      enabled: user.Enabled,
      created: user.UserCreateDate,
      attributes: Object.fromEntries(
        (user.Attributes ?? []).map(({ Name, Value }) => [Name, Value]),
      ),
    },
  }));
  return {
    ...base,
    source: `cognito:${userPoolId}`,
    records,
    totalRecords: records.length,
    redacted: false,
  };
}
