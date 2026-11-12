#!/usr/bin/env node
import { main } from '../dist/cli.js';

main().then(
  (code) => {
    if (code) process.exitCode = code;
  },
  (err) => {
    console.error(`\x1b[31merror\x1b[39m ${err instanceof Error ? err.message : err}`);
    process.exitCode = 1;
  },
);
