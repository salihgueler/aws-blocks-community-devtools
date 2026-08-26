import type {
  DiscoveredBlock,
  ResourceGroup,
  ResourceInventory,
  ResourceRow,
} from "../shared/types.js";
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

const squash = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Constructs declared on the CDK side (aws-blocks/index.cdk.ts) rather than on
 * the Scope, so block discovery never sees them.
 *
 * A CloudFormation logical id is the CDK construct path concatenated, so every
 * resource Hosting creates is prefixed "Hosting" — which is enough to group
 * them without parsing index.cdk.ts. That matters, because the declaration
 * there is conditional (`if (!sandboxMode) new Hosting(...)`): a static read of
 * that file would claim Hosting exists in sandbox deploys where it does not,
 * whereas a logical-id prefix only ever matches resources that really shipped.
 *
 * A curated list and not a general "first construct segment" rule, because the
 * framework's own internals share that shape ("Blocks*", "Handler*") and are
 * better left in service groups — bucketing 45 plumbing resources under one
 * heading is the burying problem this grouping exists to solve.
 */
const FEATURE_CONSTRUCTS: { prefix: string; label: string; note: string }[] = [
  {
    prefix: "hosting",
    label: "Hosting",
    note: "Static site and CDN, declared in aws-blocks/index.cdk.ts rather than as a block",
  },
];

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
      kind: "block",
      label: `${block.id} · ${block.type}`,
      note: null,
      resources: sortRows(rows),
    });
  }
  base.groups.sort((a, b) => (a.label > b.label ? 1 : -1));

  const unclaimed = grouped.get(null);
  if (unclaimed) {
    // Pull CDK-side features out first so their linkable resources (the
    // CloudFront distribution, the site bucket) are not scattered across nine
    // service groups.
    for (const feature of FEATURE_CONSTRUCTS) {
      const owned = unclaimed.filter((row) => squash(row.logicalId).startsWith(feature.prefix));
      if (owned.length === 0) continue;
      for (const row of owned) unclaimed.splice(unclaimed.indexOf(row), 1);
      base.groups.push({
        blockFullId: null,
        kind: "feature",
        label: feature.label,
        note: feature.note,
        resources: sortRows(owned),
      });
    }
  }
  if (unclaimed && unclaimed.length > 0) {
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
        kind: "service" as const,
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
        kind: group.kind,
        label: group.label,
        note: null,
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
