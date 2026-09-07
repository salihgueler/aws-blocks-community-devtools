# Version delta — post-0.4.0 (main-only)

This skill is pinned to published **`@aws-blocks/blocks@0.4.0`** (release commit
`04d4b21`, 2026-09-01). The rows below are the changes that landed on `main`
**after** that release and are therefore **not in 0.4.0** — do not rely on them
against an installed `0.4.0`.

> **Rule:** anything **not** in this table is assumed shipped in `0.4.0`. If you
> mention a row's feature in the skill, tag it "unreleased, main-only, post-0.4.0".

| Feature | Commit | PR | Package | One-line effect | Status |
|---|---|---|---|---|---|
| Remove inert `structuredOutput` from `AgentConfig` | `2cb9d74` | #479 | `bb-agent` | Deletes the never-consumed `structuredOutput?: z.ZodType` field from `AgentConfig` (and `API.md`) entirely. | main-only, not in 0.4.0 |
| Cron schedule/timezone validation at synth | `165093b` | #458 | `bb-cron-job` | `validateSchedule`/`validateTimezone` run at CDK synth, not deploy, so a bad `schedule`/`timezone` fails fast instead of after provisioning. | main-only, not in 0.4.0 |
| Stack defaults: logRetention / throttling / accessLogging | `c45eb92` | #385 | `core` | `BlocksPresets` gains `logRetention`, `throttling` (`rateLimit`/`burstLimit`), and `accessLogging` Infrastructure Options (sandbox vs production defaults). | main-only, not in 0.4.0 |
| Config registry retarget → shared role + per-stack compute registry | `64ddd74` | #391 | `core` | Retargets the config registry onto a shared role and adds a per-stack compute registry (`compute-registry.ts`). | main-only, not in 0.4.0 |
| Per-turn model + tool-call caps | `9111c0c` | #455 | `bb-agent` | Adds `maxLlmCalls?: number \| false` and `maxToolIterations?: number \| false` to `AgentConfig` to bound runaway cost; a cap trip ends the turn with an `error` chunk. | main-only, not in 0.4.0 |
| Fail fast on invalid stack/stage name | `5960fa4` | #456 | `pipeline` | Pipeline stage-name validation tightened to the CloudFormation stack-name contract (`/^[A-Za-z][A-Za-z0-9-]*$/`) so an invalid name throws at synth, not minutes into provisioning. | main-only, not in 0.4.0 |

## Source proof (verified at HEAD `2cb9d74`)

- `2cb9d74` — `grep -rn structuredOutput packages/bb-agent/src` → **zero** matches;
  present at `0.4.0` (`packages/bb-agent/src/types.ts:88` under `04d4b21`).
- `165093b` — `packages/bb-cron-job/src/index.cdk.ts:27-28` calls
  `validateSchedule(options.schedule)` / `validateTimezone(...)`; logic in
  `packages/bb-cron-job/src/schedule.ts`.
- `c45eb92` — `packages/core/src/cdk/blocks-defaults.ts:73,83,100` define
  `logRetention`, `throttling`, `accessLogging`; presets at lines 118-139.
- `64ddd74` — `packages/core/src/cdk/config-registry.ts` +
  `packages/core/src/cdk/compute/compute-registry.ts` (new).
- `9111c0c` — `packages/bb-agent/src/types.ts:108,120` (`maxLlmCalls`,
  `maxToolIterations`); **not** present at `0.4.0`.
- `5960fa4` — `packages/pipeline/src/pipeline-construct.ts` (`validateStageName`
  regex tightened to `/^[A-Za-z][A-Za-z0-9-]*$/`). Note: commit subject reads
  `fix(core)` but the diff is entirely in the `pipeline` package.
