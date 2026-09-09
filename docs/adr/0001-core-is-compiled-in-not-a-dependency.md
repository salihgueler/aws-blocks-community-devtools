# 0001 — The private core is compiled in, never shipped as a dependency

Status: Accepted

## Context

The repo publishes two packages to npm — `aws-blocks-console` and
`aws-blocks-mcp` — and both share a large amount of logic (cloud readers,
resource mapping, redaction, CDK parsing). That shared logic lives in a third
package, `@aws-blocks-devtools/core`.

`core` is explicitly private and unpublished. `packages/core/package.json:4`
declares `"private": true`, and its own description states the intent
(`packages/core/package.json:6`):

> "Transport-free core shared by aws-blocks-console and aws-blocks-mcp. Not
> published; both packages bundle it."

Because it is never published, a consumer's `npm install aws-blocks-console`
can only resolve `@aws-blocks-devtools/core` if it were declared as a runtime
dependency of the published package — and there is no such version on the
registry, so that install would simply fail. The build is set up so the
question never arises: the core is compiled *into* both bundles instead.

## Decision

`@aws-blocks-devtools/core` is bundled into each published package at build
time and is **never declared as a runtime dependency**. The invariant:
`@aws-blocks-devtools/core` must never appear in a consumer's `node_modules`.

Two mechanisms enforce this together:

1. **tsup `noExternal`** pulls the core's source into the emitted bundle. Both
   configs do this and both carry a comment explaining why:
   - `packages/console/tsup.config.ts:12` —
     `noExternal: ["@aws-blocks-devtools/core"]`, commented "the shared core is
     private, so it is compiled in rather than declared as a runtime
     dependency."
   - `packages/mcp/tsup.config.ts:12` — same directive, commented "The shared
     core is private and never published, so it must be compiled INTO this
     bundle. Everything else stays external and resolves from node_modules."

2. **`devDependencies`, not `dependencies`.** The core is listed only under
   `devDependencies` in both published packages —
   `packages/console/package.json:55` and `packages/mcp/package.json:52`, each
   as `"@aws-blocks-devtools/core": "*"`. It is present at build time (so tsup
   can inline it) and absent from the dependency closure a consumer installs.

The AWS SDK clients and `ts-morph` that the core *uses* are declared as real
runtime `dependencies` of each published package (e.g.
`packages/console/package.json` dependencies block,
`packages/mcp/package.json` dependencies block), so the inlined core still
resolves its own imports at runtime. Only the core package itself is inlined.

## Consequences

- The published tarballs are self-contained: the compiled core ships inside
  `dist/` and `dist-server/`, and nothing named `@aws-blocks-devtools/core`
  reaches the consumer's tree.
- `core` has no public API surface and therefore no stability contract, no
  semver, and no changelog. It can be refactored freely between releases
  because nothing outside this repo can import it.
- Two `noExternal` entries and two `devDependencies` placements must stay in
  agreement across the packages. Moving the package to a real `dependency`
  (see below) is the one change that quietly breaks the invariant, so both
  tsup configs carry the rationale inline as a guard.

## Alternatives considered and rejected

- **Publish `@aws-blocks-devtools/core` and depend on it normally.** This is
  the "obvious fix" a new contributor reaches for when they notice a
  `devDependency` that looks like it should be a runtime one. It is rejected
  because it turns an internal, contract-free module into a public API: once it
  is on the registry, consumers (and other tools) can install and import it,
  and every internal refactor becomes a potential breaking change for people
  the maintainer never intended to support. It also reintroduces version-skew
  bugs — a consumer could end up with a `core` version that disagrees with the
  `console`/`mcp` version that expects it. If someone "fixes" the setup by
  moving the entry from `devDependencies` to `dependencies` and dropping the
  `noExternal` line, installs of the published package will fail to resolve the
  (still-unpublished) core; publishing the core to make the install succeed is
  what actually causes the harm above.

- **A monorepo workspace symlink at runtime.** Works inside this repo, does
  nothing for a published consumer who has only the tarball. Rejected as not
  addressing the distribution case at all.
