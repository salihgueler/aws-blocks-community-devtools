# 0002 — Feature resources are grouped by a curated list, not by parsing the CDK app

Status: Accepted

## Context

The deployed-resource inventory (`packages/console/server/resource-inventory.ts`)
takes the flat list of CloudFormation resources in a stack and groups them so a
human can read them: "these resources exist because of that Building Block."
Most resources are attributed to a block by matching a squashed CloudFormation
logical-id prefix against each discovered block's id
(`resource-inventory.ts`, the `claimants` / `owner` logic).

Some infrastructure is not a Building Block at all. It is declared directly on
the CDK side, in a user project's `aws-blocks/index.cdk.ts`, so block discovery
(which walks the Scope) never sees it. The prominent case is **Hosting** — the
static site and CDN. Its resources would otherwise scatter across the generic
per-service fallback groups (CloudFront, S3, IAM, Lambda), burying the two
resources actually worth clicking.

The tempting approach is to statically parse `index.cdk.ts` to learn which
features a project declares, then group by that. The code deliberately does not
do this, and the reason is specific and load-bearing.

## Decision

CDK-side features are grouped by a **hand-maintained curated list**,
`FEATURE_CONSTRUCTS` in `resource-inventory.ts`, keyed on the CloudFormation
logical-id prefix — not by parsing `index.cdk.ts`.

The list currently holds one entry:

```ts
const FEATURE_CONSTRUCTS: { prefix: string; label: string; note: string }[] = [
  {
    prefix: "hosting",
    label: "Hosting",
    note: "Static site and CDN, declared in aws-blocks/index.cdk.ts rather than as a block",
  },
];
```

Grouping is done by prefix-matching against resources that are already in the
*deployed* stack: a resource is pulled into the Hosting group only when its
squashed logical id starts with `hosting` (the `owned = unclaimed.filter(...)`
step, then `unclaimed.splice(...)` to remove it before the per-service
fallback runs).

The rationale is recorded in the code comment above `FEATURE_CONSTRUCTS`, and
it is the crux of the decision:

> "the declaration there is conditional (`if (!sandboxMode) new Hosting(...)`):
> a static read of that file would claim Hosting exists in sandbox deploys
> where it does not, whereas a logical-id prefix only ever matches resources
> that really shipped."

Because a CloudFormation logical id is the CDK construct path concatenated,
every resource Hosting creates is prefixed `Hosting`, which is enough to group
them without reading the source file at all. Matching against deployed
resources means the group appears exactly when Hosting actually shipped and is
absent otherwise — automatically correct for the sandbox case.

The comment also records why this is a curated list rather than a general
"group by first construct-path segment" rule: the framework's own internal
constructs share that shape (`Blocks*`, `Handler*`) and are better left in the
service-plumbing groups. A blanket rule would bucket ~45 plumbing resources
under invented headings, which is the exact "burying" problem this grouping
exists to solve.

## Consequences

- The inventory reflects **what was deployed**, not what the source *could*
  deploy. A sandbox deployment with no Hosting shows no Hosting group, with no
  special-casing needed.
- Adding a new conditionally-declared CDK feature requires a one-line addition
  to `FEATURE_CONSTRUCTS` (prefix + label + note). This is a deliberate, cheap
  maintenance cost accepted in exchange for correctness.
- The grouping never needs to read, parse, or evaluate user CDK source, so it
  cannot be fooled by conditionals, environment branches, or dead code in
  `index.cdk.ts`.

## Alternatives considered and rejected

- **Statically parse `index.cdk.ts` (e.g. with ts-morph) to discover declared
  features.** Rejected because the declaration is conditional. A static read
  sees `new Hosting(...)` inside an `if (!sandboxMode)` branch and cannot know,
  without executing the app, whether that branch ran for a given deployment. It
  would therefore claim Hosting resources exist in sandbox deployments where
  they do not — reporting infrastructure that isn't there. The deployed stack
  is the ground truth; the source file is only a recipe.

- **A general "first construct-path segment" grouping rule.** Rejected because
  the framework's internal constructs (`Blocks*`, `Handler*`) share the same
  path shape as real features, so the rule would manufacture headings for pure
  plumbing and scatter the ~45 framework resources the flat-bucket problem was
  meant to consolidate. The curated list keeps only the segments that are
  genuinely user-facing features.
