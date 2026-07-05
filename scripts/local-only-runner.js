#!/usr/bin/env node
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const command = process.argv.slice(2);
if (command.length === 0) {
  console.error('usage: node scripts/local-only-runner.js <command> [args...]');
  process.exit(2);
}

let runnerName = '';
const token = randomBytes(16).toString('hex');
const dir = mkdtempSync(join(tmpdir(), 'zbrain-local-only-'));
const attestationPath = join(dir, 'attestation.json');
const env = {
  ...process.env,
  ZBRAIN_LOCAL_ONLY_ENFORCED: '1',
  ZBRAIN_LOCAL_ONLY_TOKEN: token,
  ZBRAIN_LOCAL_ONLY_ATTESTATION_PATH: attestationPath,
};
let runner;
if (process.platform === 'darwin') {
  runnerName = 'sandbox-exec';
  runner = ['/usr/bin/sandbox-exec', ['-p', '(version 1) (allow default) (deny network*)', '--', ...command]];
} else if (process.platform === 'linux') {
  const probe = spawnSync('unshare', ['--help'], { stdio: 'ignore' });
  if (probe.status !== 0) {
    console.error('local-only runner requires unshare on linux; install util-linux or run in a container with --network none');
    process.exit(2);
  }
  runnerName = 'unshare-net';
  runner = ['unshare', ['--net', '--', ...command]];
} else {
  console.error(`local-only runner unsupported on ${process.platform}`);
  process.exit(2);
}

env.ZBRAIN_LOCAL_ONLY_RUNNER = runnerName;
writeFileSync(attestationPath, JSON.stringify({ runner: runnerName, token, platform: process.platform, createdAt: new Date().toISOString() }));
const result = spawnSync(runner[0], runner[1], { stdio: 'inherit', env });
process.exit(result.status ?? 1);
