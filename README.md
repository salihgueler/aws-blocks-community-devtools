# AWS Blocks community devtools

Community developer tools for [AWS Blocks](https://www.npmjs.com/package/@aws-blocks/blocks) projects. Two independent tools that read the same project and share one core.

| Package | What it is |
| --- | --- |
| [`aws-blocks-console`](https://www.npmjs.com/package/aws-blocks-console) ([source](packages/console)) | A local-first admin console in your browser. Browse your Building Blocks, read local `.bb-data` or deployed DynamoDB/Cognito data, call your API, and open deployed AWS resources. |
| [`aws-blocks-mcp`](https://www.npmjs.com/package/aws-blocks-mcp) ([source](packages/mcp)) | An MCP server, so an AI agent can do the same things over stdio. Read-only unless you opt in. |

Neither one needs configuration. Run either inside an AWS Blocks project and it finds the project, its scope, its blocks, and its deployed stack on its own.

```bash
# Browse a project in your browser
npx aws-blocks-console

# Register the MCP server with your agents (Kiro, Cursor, Claude Code)
npx aws-blocks-console connect
```

## Why two packages

They are genuinely different products with different audiences: one renders pixels for a human, the other speaks a protocol to an agent. Keeping them separate means an agent installing the MCP server does not also download a React UI it will never render.

They are not, however, two implementations. Everything that actually understands an AWS Blocks project — block discovery, environment detection, data reading, secret redaction, the JSON-RPC seam — lives in one private `core` workspace that both packages compile into their own bundle at build time. That is why `packages/core` exists and is not published: one source of truth, two shipped artifacts, and no third thing for you to install.

```
packages/
  core/       private, unpublished — bundled into both packages below
  console/    aws-blocks-console  → HTTP + browser UI + the CLI
  mcp/        aws-blocks-mcp      → stdio adapter for agents
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
