# Logger

Structured JSON logging with levels, inherited context, and child loggers. Both
locally and on AWS it writes one JSON line per entry to stdout (stderr for
`error`); on Lambda those lines land in CloudWatch Logs.

**Use it for** request tracking, error reporting, audit trails, debugging
context.

**Don't use it for** numeric measurements over time (use Metrics) or
cross-service request tracing (use Tracer).

## Contents

- Import and minimal example
- `LoggingOptions`
- Level precedence: constructor > `LOG_LEVEL` env > `'info'`
- Methods are synchronous
- Log entry format
- Errors
- What it provisions

## Import and minimal example

Re-exported from the umbrella `@aws-blocks/blocks`.

```typescript
import { Logger } from '@aws-blocks/blocks';

const logger = new Logger(scope, 'log', {
  level: 'info',
  defaultContext: { service: 'my-app' },
  retention: 30,
});

logger.info('User signed in', { userId: 'u123' });
logger.error('Payment failed', { orderId: 'o1', error: err.message });
logger.debug('Cache miss', { key: 'user:u123' });   // dropped when level > debug

const requestLogger = logger.child({ requestId: 'req-abc' });
requestLogger.info('Processing');   // entry carries { service, requestId }
```

## `LoggingOptions`

```typescript
interface LoggingOptions {
  level?: LogLevel;               // 'debug' | 'info' | 'warn' | 'error'
  defaultContext?: Record<string, unknown>;
  retention?: RetentionDays;
}
```

- `level` sets the minimum; anything below is dropped. See the precedence rule
  below for how it interacts with the `LOG_LEVEL` env var.
- `defaultContext` merges into every entry. The reserved structural keys
  `level`, `message`, `timestamp`, `logger`, and `traceId` are owned by the
  logger — any such keys in your context (or a `child()` context) are ignored so
  they cannot corrupt the entry.
- `retention` accepts **only** these fixed day values (the AWS CloudWatch API
  set): `1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365, 400, 545, 731, 1096,
  1827, 2192, 2557, 2922, 3288, 3653`. Any other number is a type error. When
  set, the block creates a CloudWatch LogGroup with that retention and
  `RemovalPolicy.DESTROY`; when omitted, Lambda's auto-created log group applies
  and logs never expire. Ignored in local dev.

## Level precedence: constructor > `LOG_LEVEL` env > `'info'`

The effective level is resolved in that order. An explicit `level` in options
always wins; with no `level`, the `LOG_LEVEL` environment variable is used; with
neither, it defaults to `'info'`. Note the split: passing `level` in the CDK
layer sets the `LOG_LEVEL` env var on the shared handler, so a level configured
at construction reaches the runtime that way as well.

## Methods are synchronous

```
debug(msg, ctx?)  info(msg, ctx?)  warn(msg, ctx?)  error(msg, ctx?)  child(ctx)
```

All logging methods return `void`, **not** a Promise — do not `await` them.
Writing to stdout/stderr is synchronous and Lambda captures the stream
asynchronously, so returning a Promise would add overhead for no benefit.

`child(ctx)` returns a `ChildLogger` (the same five methods) whose context is the
parent's merged with `ctx`; children can be nested. A `ChildLogger` is not a
Scope node.

## Log entry format

```typescript
interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;   // ISO 8601
  logger: string;      // the logger's id
  traceId?: string;    // auto-injected in Lambda when X-Ray tracing is active
  [key: string]: unknown;   // your merged context
}
```

`traceId` appears automatically when the function runs in Lambda **with X-Ray
active tracing on** — which the Tracer block enables. That is what lets you pivot
from a log line to its trace; without a Tracer (or with tracing off) the field is
simply absent.

## Errors

`LoggingErrors.SerializationFailed` (`SerializationFailedException`) — a context
value could not be JSON-serialized (e.g. a `BigInt` or a circular reference).
Import `LoggingErrors` from `@aws-blocks/blocks`.

## What it provisions

Nothing by default — logs flow through Lambda's own log group. With `retention`
set, one CloudWatch LogGroup with that retention policy and
`RemovalPolicy.DESTROY`.
