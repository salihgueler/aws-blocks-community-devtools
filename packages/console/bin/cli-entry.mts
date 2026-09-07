/**
 * Development entry point for the CLI.
 *
 * bin/aws-blocks-console.mjs runs the compiled dist-server/ build that ships in the
 * npm package. This file runs the TypeScript sources directly through tsx, so
 * the CLI is usable from a checkout before anything is built or published.
 */
import { runCli } from "../server/cli.js";

process.exitCode = await runCli(process.argv.slice(2));
