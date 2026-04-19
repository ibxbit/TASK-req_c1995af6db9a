#!/usr/bin/env node
// Cross-platform unit-test discovery + runner.
//
// Globs every `*.test.js` under `../unit_tests` (excluding helper files that
// start with `_`) and hands them to the built-in Node test runner. Works the
// same under bash, zsh, cmd.exe, and PowerShell without relying on shell
// wildcard expansion.
import { run } from 'node:test';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spec } from 'node:test/reporters';
import { pipeline } from 'node:stream/promises';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', 'unit_tests');
const files = readdirSync(root)
  .filter((f) => f.endsWith('.test.js') && !f.startsWith('_'))
  .map((f) => path.join(root, f))
  .filter((p) => statSync(p).isFile());

const stream = run({ files, concurrency: 1 });
stream.on('test:fail', () => { process.exitCode = 1; });

await pipeline(stream.compose(new spec()), process.stdout);
