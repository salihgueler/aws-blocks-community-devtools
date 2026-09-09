# 0003 — The read-only cloud seam is enforced by an absence

Status: Accepted

## Context

The console and MCP server let you browse data in a deployed AWS Blocks stack:
scan DynamoDB tables, list Cognito users. Reading someone's production data is
already sensitive; accidentally *writing* to it would be far worse. The design
goal is that cloud reads can never mutate the account.

There is no runtime flag or policy object that marks the cloud read path as
read-only. Instead, the guarantee is structural: the module that performs cloud
reads imports **only** read APIs, and the AWS SDK cannot issue a write it was
never handed the command class for.

## Decision

`packages/core/src/cloud-data.ts` — the cloud read path — imports zero AWS
write APIs. Its imports are exclusively read/list operations:

- `packages/core/src/cloud-data.ts:1` — `DescribeTableCommand, DynamoDBClient`
- `packages/core/src/cloud-data.ts:2` — `DynamoDBDocumentClient, ScanCommand`
- `packages/core/src/cloud-data.ts:3-6` — `CognitoIdentityProviderClient,
  ListUsersCommand`

The file's own header comment states this is the enforcement seam:

> "Read-only cloud browsers. Every call here is a Get/List/Scan — no write
> APIs are imported in this module, which is the enforcement seam for the
> 'cloud is read-only' guarantee until an explicit unlock feature exists."

The absence of any write import *is* the safety mechanism. There is no test,
lint rule, or type constraint asserting it; the guarantee holds only as long as
the import list stays free of write commands (`PutCommand`, `UpdateCommand`,
`DeleteCommand`, `AdminCreateUser`, etc.).

Writes are a separate, explicitly-gated path. The DynamoDB write commands live
only in dedicated modules — `PutCommand` in
`packages/console/server/puts.ts:4` and `DeleteCommand` in
`packages/console/server/writes.ts:4` — never in `cloud-data.ts`. Those writes
are locked by default behind an in-memory, self-expiring unlock enforced
server-side in `packages/console/server/write-guard.ts`:

- `write-guard.ts:7` — `const UNLOCK_TTL_MS = 15 * 60 * 1000;`
- `setUnlocked` / `isUnlocked` — a 15-minute TTL from the moment of unlock; a
  console restart or 15 idle minutes re-locks (`write-guard.ts:1-4` header,
  `isUnlocked` expiry check at `write-guard.ts:16-19`).

So the two guarantees are independent: cloud *reads* are safe because
`cloud-data.ts` has no write imports; cloud *writes* are safe because they live
elsewhere behind the time-limited unlock. This ADR is primarily about the
first.

## Consequences

- The read path cannot mutate the account no matter what arguments reach it —
  the SDK has no write command to invoke.
- The guarantee is **silent and untested**. Adding a single write import (and a
  call) to `cloud-data.ts` would remove the guarantee with no failing test, no
  type error, and no build failure. Nothing marks that import as forbidden; a
  contributor "reusing the client that's already here" to add a delete would
  breach the seam invisibly.
- Any hardening (a lint rule banning write-command imports in this module, or a
  dependency-cruiser boundary) would strengthen the invariant, but none exists
  today. Until then the header comment is the only marker, and code review is
  the only gate.

## Alternatives considered and rejected

- **A runtime read-only flag checked before each call.** Rejected in favor of
  the structural approach for the read path: a flag can be misread, defaulted
  wrong, or bypassed by a code path that forgets to check it, whereas a module
  that never imports a write command cannot issue one regardless of flags. (The
  write path does use exactly this pattern — `write-guard.ts` — because writes
  genuinely need to be enabled sometimes; reads never do.)

- **Rely on IAM to deny writes.** Rejected as the sole mechanism because the
  console runs with whatever credentials the user already has, which for many
  developers include write access to their own dev stack. The read-only
  guarantee must hold at the application layer, not depend on the caller having
  a restricted role.

- **Do nothing / trust convention.** This is effectively the current state for
  enforcement (there is no test), and it is why this ADR exists: to make the
  invariant explicit so a future contributor knows the empty write-import list
  is deliberate, not an oversight, and that adding to it is a security change,
  not a refactor.
