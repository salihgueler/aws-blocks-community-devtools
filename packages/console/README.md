# aws-blocks-console

A local-first admin console for [AWS Blocks](https://www.npmjs.com/package/@aws-blocks/blocks) projects. Think Prisma Studio, but for Building Blocks.

```bash
npx aws-blocks-console
```

Run it inside an AWS Blocks project. It walks up from the current directory to find `aws-blocks/index.ts`, discovers your blocks, picks a free port, and opens a browser. No flags, no config file, no project path.

## What you get

- **Your blocks, grouped by category** — discovered by parsing your source, so the list matches what you actually declared rather than what is deployed.
- **Local and cloud data side by side** — read `.bb-data` from your dev server, or scan the deployed DynamoDB tables and Cognito pool for the same block. Key names come from `DescribeTable`, so composite keys render correctly instead of being assumed to be `pk`/`sk`.
- **A JSON-RPC playground** — call your API methods against either the local dev server or the deployed endpoint, with parameter names pulled from your own method signatures.
- **Deployed resources** — every CloudFormation resource in the stack, grouped by the block that caused it, each linking into the AWS console.
- **Writes, when you ask for them** — create, edit and delete records behind an explicit unlock that re-locks after 15 minutes.

## Commands

```bash
aws-blocks-console                 # serve the UI (default)
aws-blocks-console doctor          # report what was detected, change nothing
aws-blocks-console connect         # register aws-blocks-mcp with your agents
```

| Option | |
| --- | --- |
| `-p, --project <path>` | Project to inspect (default: found from the current directory) |
| `--profile <name>` | AWS profile for cloud mode |
| `--region <region>` | AWS region for cloud mode |
| `--port <port>` | Port to serve on (default: first free from 4400) |
| `--no-open` | Do not open a browser |

Running it in a monorepo root that contains several Blocks projects reports the candidates it found rather than guessing which one you meant.

## Local mode needs no AWS

Block discovery, `.bb-data` browsing, record editing and the RPC playground all work with no AWS credentials whatsoever — verified with a deliberately nonexistent profile. Only cloud browsing needs credentials and a deployed stack, and `doctor` tells you which of the two is missing rather than reporting a generic failure.

The AWS CLI is never invoked. Cloud mode uses the AWS SDK, which reads `~/.aws/config` directly, so only your credentials matter — not whether you have the CLI installed.

## Safety

The server binds `127.0.0.1` only. Values shaped like credentials are redacted before they reach the browser, judged by the value's shape rather than its field name — a name-based denylist is exactly how password hashes leak out of a table nobody thought to add to the list. Cloud writes are refused server-side while locked, so the gate is not merely a UI affordance.

Local writes are refused while your dev server is running, because the mock loads `.bb-data` once at startup and would overwrite anything written underneath it.

## License

MIT
