# aws-blocks-mcp

An [MCP](https://modelcontextprotocol.io) server for [AWS Blocks](https://www.npmjs.com/package/@aws-blocks/blocks) projects. It lets an AI agent understand the project it is sitting in — which blocks exist, what data they hold locally and in AWS, and what your API returns.

## Setup

The easiest path registers it for you, backing up the config first and preserving every other server already in it:

```bash
npx aws-blocks-console connect
```

Or add it by hand:

```json
{
  "mcpServers": {
    "aws-blocks-mcp": {
      "command": "npx",
      "args": ["-y", "aws-blocks-mcp"],
      "autoApprove": ["blocks_project", "blocks_read", "blocks_rpc"]
    }
  }
}
```

No project path is baked in. The server resolves the project from the agent's working directory, so one registration covers every AWS Blocks project you work on. MCP servers spawn when your agent starts, so restart the agent after registering.

## Tools

| Tool | What it does |
| --- | --- |
| `blocks_project` | The project's scope, every block with its type and key schema, its API methods, and whether a deployed stack was found. Start here — the other tools take ids from it. |
| `blocks_read` | Records from one block's store, from local `.bb-data` or the deployed DynamoDB table / Cognito pool. |
| `blocks_rpc` | Calls an API method against the local dev server or the deployed endpoint. |

An unknown block id fails loudly with the list of real ids rather than returning an empty result, so an agent corrects itself instead of concluding your table is empty.

## Read-only by default

Only the three read tools above are registered. Write tools are **not registered at all** unless `AWS_BLOCKS_MCP_ALLOW_WRITES=1` is set — not merely refused when called, but absent from the tool list, so an agent cannot alter production data unattended. `blocks_project` reports `writesEnabled: false` so the agent can explain the limitation rather than failing mysteriously.

For interactive writes against a real stack, use [`aws-blocks-console`](https://github.com/salihgueler/aws-blocks-community-devtools/tree/main/packages/console), whose unlock gate keeps a human in the loop.

Values shaped like credentials are redacted before they leave the server, in both local and cloud reads.

## Local mode needs no AWS

All three tools work against a local dev server with no AWS credentials. Only reading deployed data needs credentials and a stack.

## License

MIT
