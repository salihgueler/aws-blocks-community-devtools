import type { DiscoveredBlock } from "../shared/types.js";
import { listAllResources, type CloudClientOptions } from "./cloud-resources.js";
import { consoleLink, friendlyType, stackResourcesUrl } from "./console-links.js";

/**
 * The full deployed inventory, grouped by the block that caused each resource.
 *
 * Blocks hide AWS on purpose: one `new DistributedTable(...)` becomes a table,
 * an IAM role, alarms and more. This turns that back into something readable —
 * "these resources exist because of that line" — with everything the framework
 * created (CDK metadata, bucket-deployment lambdas, custom resources) in its
 * own group rather than pretending it belongs to a block.
 *
 * No new AWS calls: listAllResources is the same paginated, 5-minute-cached
 * fetch that block-to-resource mapping already performs.
 */

export interface ResourceRow {
  logicalId: string;
  physicalId: string;
  type: string;
  typeLabel: string;
  status: string | null;
  consoleUrl: string;
  /** false when the link points at the stack rather than the resource itself */
  directLink: boolean;
}

export interface ResourceGroup {
  /** Block fullId, or null for resources no block claims */
  blockFullId: string | null;
  label: string;
  resources: ResourceRow[];
}

export interface ResourceInventory {
  stackName: string;
  region: string;
  accountId: string | null;
  total: number;
  groups: ResourceGroup[];
  stackUrl: string;
  error: string | null;
}

const squash = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

export async function buildResourceInventory(
  stackName: string,
  region: string,
  accountId: string | null,
  blocks: DiscoveredBlock[],
  options: CloudClientOptions,
): Promise<ResourceInventory> {
  const base: ResourceInventory = {
    stackName,
    region,
    accountId,
    total: 0,
    groups: [],
    stackUrl: stackResourcesUrl(stackName, region),
    error: null,
  };
  let resources;
  try {
    resources = await listAllResources(stackName, options);
  } catch (error) {
    return { ...base, error: error instanceof Error ? error.message : String(error) };
  }

  // Longest squashed id first, so 'myapp-auth-sessions' claims a resource
  // before the shorter 'myapp-auth' can.
  const claimants = blocks
    .map((block) => ({ block, key: squash(block.fullId) }))
    .sort((a, b) => b.key.length - a.key.length);

  const grouped = new Map<string | null, ResourceRow[]>();
  base.total = resources.length;

  for (const resource of resources) {
    const logicalId = resource.LogicalResourceId ?? "";
    const physicalId = resource.PhysicalResourceId ?? "";
    const type = resource.ResourceType ?? "unknown";
    if (!logicalId) continue;

    const squashedLogical = squash(logicalId);
    const owner = claimants.find((candidate) => squashedLogical.startsWith(candidate.key));
    const key = owner?.block.fullId ?? null;

    const link = physicalId
      ? consoleLink(type, physicalId, region, stackName)
      : { url: base.stackUrl, direct: false };

    const rows = grouped.get(key) ?? [];
    rows.push({
      logicalId,
      physicalId,
      type,
      typeLabel: friendlyType(type),
      status: resource.ResourceStatus ?? null,
      consoleUrl: link.url,
      directLink: link.direct,
    });
    grouped.set(key, rows);
  }

  // Blocks in declaration order first, framework resources last.
  for (const { block } of [...claimants].reverse()) {
    const rows = grouped.get(block.fullId);
    if (!rows) continue;
    base.groups.push({
      blockFullId: block.fullId,
      label: `${block.id} · ${block.type}`,
      resources: sortRows(rows),
    });
  }
  base.groups.sort((a, b) => (a.label > b.label ? 1 : -1));

  const unclaimed = grouped.get(null);
  if (unclaimed) {
    // One flat bucket buried the resources worth clicking (the CloudFront
    // distribution, the API) under ~30 IAM entries and ~30 Lambda plumbing
    // rows, so split by AWS service instead. Services with something linkable
    // come first; pure plumbing (IAM policies, permissions) sinks.
    const byService = new Map<string, ResourceRow[]>();
    for (const row of unclaimed) {
      const service = row.type.split("::")[1] ?? "Other";
      byService.set(service, [...(byService.get(service) ?? []), row]);
    }
    const serviceGroups = [...byService.entries()]
      .map(([service, rows]) => ({
        blockFullId: null,
        label: service,
        resources: sortRows(rows),
        linkable: rows.filter((row) => row.directLink).length,
      }))
      .sort(
        (a, b) =>
          Number(b.linkable > 0) - Number(a.linkable > 0) ||
          b.resources.length - a.resources.length,
      );
    for (const group of serviceGroups) {
      base.groups.push({
        blockFullId: group.blockFullId,
        label: group.label,
        resources: group.resources,
      });
    }
  }
  return base;
}

/** Linkable resources first — they are the ones worth clicking. */
function sortRows(rows: ResourceRow[]): ResourceRow[] {
  return rows.sort((a, b) => {
    if (a.directLink !== b.directLink) return a.directLink ? -1 : 1;
    return a.typeLabel.localeCompare(b.typeLabel) || a.logicalId.localeCompare(b.logicalId);
  });
}
