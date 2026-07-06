import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const bin = path.resolve('bin/zbrain.js');

test('CLI rejects --allow-network in M0/M1', () => {
  const result = spawnSync(process.execPath, [bin, 'privacy-probe', '--allow-network'], {
    cwd: process.cwd(),
    env: { ...process.env, ZBRAIN_LOCAL_ONLY_ENFORCED: '1', ZBRAIN_LOCAL_ONLY_RUNNER: 'sandbox-exec', ZBRAIN_LOCAL_ONLY_TOKEN: 'x', ZBRAIN_LOCAL_ONLY_ATTESTATION_PATH: fakeAttestation('sandbox-exec', 'x') },
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--allow-network is not supported/);
});

test('absolute CLI help works from another cwd', () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'zbrain-cli-cwd-'));
  const result = spawnSync(process.execPath, [bin, 'help'], {
    cwd,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Commands:/);
});

function fakeAttestation(runner, token) {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'zbrain-cli-attest-')), 'attestation.json');
  writeFileSync(file, JSON.stringify({ runner, token }));
  return file;
}


test('CLI accepts --help and -h', () => {
  for (const flag of ['--help', '-h']) {
    const result = spawnSync(process.execPath, [bin, flag], { cwd: process.cwd(), encoding: 'utf8' });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /Commands:/);
  }
});
