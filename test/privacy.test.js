import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { failIfUnsupportedLocalOnly, shouldWrapLocalOnly } from '../src/privacy.js';

function attestedEnv(runner = 'unshare-net') {
  const dir = mkdtempSync(join(tmpdir(), 'zbrain-attest-'));
  const token = 'test-token';
  const file = join(dir, 'attestation.json');
  writeFileSync(file, JSON.stringify({ runner, token, platform: 'test' }));
  return {
    ZBRAIN_LOCAL_ONLY_ENFORCED: '1',
    ZBRAIN_LOCAL_ONLY_RUNNER: runner,
    ZBRAIN_LOCAL_ONLY_TOKEN: token,
    ZBRAIN_LOCAL_ONLY_ATTESTATION_PATH: file,
  };
}

test('local-only wraps on darwin before enforcement', () => {
  assert.equal(shouldWrapLocalOnly(['bench'], {}, 'darwin'), true);
  assert.equal(shouldWrapLocalOnly(['bench'], attestedEnv('sandbox-exec'), 'darwin'), false);
});

test('local-only fails closed on unsupported unenforced platform', () => {
  assert.throws(() => failIfUnsupportedLocalOnly({}, 'linux'), /requires an OS\/container network-deny/);
  assert.throws(() => failIfUnsupportedLocalOnly({ ZBRAIN_LOCAL_ONLY_ENFORCED: '1' }, 'linux'), /trusted runner/);
  assert.throws(() => failIfUnsupportedLocalOnly({ ...attestedEnv(), ZBRAIN_LOCAL_ONLY_TOKEN: 'wrong' }, 'linux'), /attestation mismatch/);
  assert.doesNotThrow(() => failIfUnsupportedLocalOnly(attestedEnv(), 'linux'));
});
