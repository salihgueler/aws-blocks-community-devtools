#!/usr/bin/env node
import { runCli } from "../dist-server/cli.js";

runCli(process.argv.slice(2))
  .then((code) => {
    // A served console keeps the event loop alive on purpose; only exit on
    // a non-zero result or a command that has finished its work.
    if (code !== 0) process.exit(code);
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
