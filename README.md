# AWS Blocks community devtools

Community developer tools for [AWS Blocks](https://www.npmjs.com/package/@aws-blocks/blocks) projects: two npm packages that read your project, and the agent skill for building on it.

| Tool | What it is |
| --- | --- |
| [`aws-blocks-console`](https://www.npmjs.com/package/aws-blocks-console) ([source](packages/console)) | A local-first admin console in your browser. Browse your Building Blocks, read local `.bb-data` or deployed DynamoDB/Cognito data, call your API, and open deployed AWS resources. |
| [`aws-blocks-mcp`](https://www.npmjs.com/package/aws-blocks-mcp) ([source](packages/mcp)) | An MCP server, so an AI agent can do the same things over stdio. Read-only unless you opt in. |
| [`aws-blocks-development`](skills/aws-blocks-development) | An agent skill covering every Building Block, the API model, scaffolding and deployment. Not published to npm — copy it into your project's skills directory. |

The two packages need no configuration. Run either inside an AWS Blocks project and it finds the project, its scope, its blocks, and its deployed stack on its own.

```bash
# Browse a project in your browser
npx aws-blocks-console

# Register the MCP server with your agents (Kiro, Cursor, Claude Code)
npx aws-blocks-console connect
```

## The agent skill

`skills/aws-blocks-development` is 33 files: a `SKILL.md` map, one reference per Building Block, and top-level files for architecture, scaffolding, native clients, testing and troubleshooting. Copy it wherever your agent looks for skills:

```bash
cp -R skills/aws-blocks-development ~/.kiro/skills/          # Kiro, all projects
cp -R skills/aws-blocks-development <project>/.claude/skills/ # Claude Code, one project
```

It is deliberately **self-contained**: the facts are written into the skill rather than deferring to bundled docs at runtime, so an agent loading it needs nothing else. Ground truth is the upstream package's own source and declarations, and every claim is pinned to a released version — currently `0.4.0`. [`VERSION-DELTA.md`](skills/aws-blocks-development/VERSION-DELTA.md) quarantines behaviour that exists on upstream `main` but has not shipped, so the skill never describes an unreleased API as available.

`scripts/drift-guard.mjs` extracts every identifier from the skill's code fences and checks them against the installed package's `.d.ts` and API report, exiting non-zero on drift. It needs a real install to compare against — point it at one:

```bash
node skills/aws-blocks-development/scripts/drift-guard.mjs \
  --node-modules /path/to/a-blocks-project/node_modules
```

Without `--node-modules` (or `BLOCKS_NODE_MODULES`) it degrades gracefully and exits 0 having checked nothing, so pass the path or the run tells you nothing. Worth doing after every `@aws-blocks/blocks` upgrade.

## Why two packages

They are genuinely different products with different audiences: one renders pixels for a human, the other speaks a protocol to an agent. Keeping them separate means an agent installing the MCP server does not also download a React UI it will never render.

They are not, however, two implementations. Everything that actually understands an AWS Blocks project — block discovery, environment detection, data reading, secret redaction, the JSON-RPC seam — lives in one private `core` workspace that both packages compile into their own bundle at build time. That is why `packages/core` exists and is not published: one source of truth, two shipped artifacts, and no third thing for you to install.

```
packages/
  core/       private, unpublished — bundled into both packages below
  console/    aws-blocks-console  → HTTP + browser UI + the CLI
  mcp/        aws-blocks-mcp      → stdio adapter for agents
skills/
  aws-blocks-development/   the agent skill (not an npm package)
```

## Local development

```bash
npm install            # one install for the whole workspace
npm run typecheck      # all three packages
npm run build          # UI bundle + both server bundles

npm run console -- doctor    # what the tools detect in the current directory
npm run verify:mcp -- <path-to-a-blocks-project>   # drive the MCP server over real stdio
```

To point your agents at this checkout instead of the published package — so your edits take effect on the next agent restart:

```bash
npm run console -- connect --local
```

## Safety

These tools read a real AWS account when you use cloud mode, so a few things are deliberate rather than incidental:

- The backend binds `127.0.0.1` only. Nothing is exposed to your network.
- Local mode needs no AWS credentials at all. Only cloud browsing does.
- Values that look like credentials — bcrypt/argon2/PBKDF2 hashes, JWTs, PEM blocks, AWS access keys — are redacted by shape, not by field name, in both local and cloud reads.
- Cloud writes are locked behind a human-in-the-loop unlock in the console UI, enforced server-side and re-locked after 15 minutes.
- The MCP server registers **read tools only**. Write tools appear solely when `AWS_BLOCKS_MCP_ALLOW_WRITES=1` is set, so an agent cannot alter production data unattended.

## License

MIT — see [LICENSE](LICENSE).
