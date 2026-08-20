import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";
import {
  CognitoIdentityProviderClient,
  ListUsersCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import type { BlockDataPage, DataRecord } from "../shared/types.js";
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
): Promise<BlockDataPage> {
  const base: BlockDataPage = {
    fullId: blockFullId,
    source: "",
    records: [],
    totalRecords: 0,
    redacted: false,
    error: null,
  };
  try {
    const resources = await resolveBlockResources(stackName, blockFullId, options);
    if (blockType.startsWith("Auth") && resources.userPoolId) {
      return await readCognitoUsers(resources.userPoolId, options, base);
    }
    const table = resources.tables[0];
    if (table) return await scanTable(table, options, base);
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
  const sensitive = SESSION_TABLE_PATTERN.test(tableName);
  const records: DataRecord[] = (page.Items ?? []).map((item, index) => {
    const key = [item.pk, item.sk].filter(Boolean).join(" · ") || String(index);
    return {
      key,
      value: sensitive ? "•••redacted (session/secret table)•••" : item,
    };
  });
  return {
    ...base,
    source: `dynamodb:${tableName}${page.LastEvaluatedKey ? ` (first ${SCAN_LIMIT})` : ""}`,
    records,
    totalRecords: page.Count ?? records.length,
    redacted: sensitive,
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
