import {
  CloudFormationClient,
  ListStackResourcesCommand,
  type StackResourceSummary,
} from "@aws-sdk/client-cloudformation";

/**
 * Maps discovered blocks to deployed physical resources.
 *
 * Naming conventions verified against a real deployed stack:
 * - DynamoDB tables: PhysicalResourceId = `<stackName>-<fullId>`
 *   (plus `<stackName>-<fullId>-sessions` for auth session stores)
 * - Cognito: LogicalResourceId = squash(fullId) + "pool"/"client" + hash,
 *   where squash() strips non-alphanumerics
 */

export interface BlockResources {
  tables: string[];
  userPoolId: string | null;
  userPoolClientId: string | null;
  buckets: string[];
}

export interface CloudClientOptions {
  profile: string;
  region?: string;
}

interface CacheEntry {
  resources: StackResourceSummary[];
  fetchedAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, CacheEntry>();

export async function listAllResources(
  stackName: string,
  options: CloudClientOptions,
): Promise<StackResourceSummary[]> {
  const cacheKey = `${options.profile}:${stackName}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.resources;

  const client = new CloudFormationClient(options);
  const resources: StackResourceSummary[] = [];
  let token: string | undefined;
  do {
    const page = await client.send(
      new ListStackResourcesCommand({ StackName: stackName, NextToken: token }),
    );
    resources.push(...(page.StackResourceSummaries ?? []));
    token = page.NextToken;
  } while (token);
  cache.set(cacheKey, { resources, fetchedAt: Date.now() });
  return resources;
}

const squash = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

export async function resolveBlockResources(
  stackName: string,
  blockFullId: string,
  options: CloudClientOptions,
): Promise<BlockResources> {
  const resources = await listAllResources(stackName, options);
  const squashedId = squash(blockFullId);
  const result: BlockResources = {
    tables: [],
    userPoolId: null,
    userPoolClientId: null,
    buckets: [],
  };
  for (const resource of resources) {
    const logical = squash(resource.LogicalResourceId ?? "");
    const physical = resource.PhysicalResourceId ?? "";
    if (!logical.startsWith(squashedId) || !physical) continue;
    switch (resource.ResourceType) {
      case "AWS::DynamoDB::Table":
        result.tables.push(physical);
        break;
      case "AWS::Cognito::UserPool":
        result.userPoolId = physical;
        break;
      case "AWS::Cognito::UserPoolClient":
        result.userPoolClientId = physical;
        break;
      case "AWS::S3::Bucket":
        result.buckets.push(physical);
        break;
    }
  }
  // Primary table first: exact `<stackName>-<fullId>` before `-sessions` etc.
  result.tables.sort((a, b) => a.length - b.length);
  return result;
}
