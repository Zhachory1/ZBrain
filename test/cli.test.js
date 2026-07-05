import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('CLI rejects --allow-network in M0', () => {
  const result = spawnSync(process.execPath, ['bin/zbrain.js', 'privacy-probe', '--allow-network'], {
    cwd: process.cwd(),
    env: { ...process.env, ZBRAIN_LOCAL_ONLY_ENFORCED: '1' },
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--allow-network is not supported in M0/);
});
