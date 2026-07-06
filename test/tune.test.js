import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const bin = path.resolve('bin/zbrain.js');

function makeFixture(corpusClass = 'synthetic') {
  const dir = mkdtempSync(path.join(tmpdir(), 'zbrain-tune-'));
  mkdirSync(path.join(dir, 'docs'), { recursive: true });
  writeFileSync(path.join(dir, 'docs', 'login.md'), '# Login Authentication\n\nCookies expire.\n');
  const manifest = path.join(dir, 'manifest.json');
  writeFileSync(manifest, JSON.stringify({
    schemaVersion: 1,
    suiteId: 'tune-test',
    corpusClass,
    corpusRoot: 'docs',
    queries: [{ id: 'q1', class: 'fuzzy_memory', query: 'sign-in problem', expected: ['login.md'], negative: [] }],
  }));
  return { dir, manifest };
}

test('tune emits alias proposal for synthetic miss without mutating config', () => {
  const { dir, manifest } = makeFixture();
  const output = path.join(dir, 'proposal.json');
  const result = spawnSync(process.execPath, [bin, 'tune', '--manifest', manifest, '--output', output, '--json'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const proposal = JSON.parse(readFileSync(output, 'utf8'));
  assert.ok(Object.keys(proposal.aliases).length > 0);
  assert.equal(existsSync(path.join(dir, '.zbrain/config.json')), false);
});

test('private tune output must stay under ~/.zbrain/tuning', () => {
  const { manifest } = makeFixture('private');
  const result = spawnSync(process.execPath, [bin, 'tune', '--manifest', manifest, '--output', '/tmp/zbrain-private-tune.json'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /private tune output/);
});

function fakeAttestation(runner, token) {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'zbrain-tune-attest-')), 'attestation.json');
  writeFileSync(file, JSON.stringify({ runner, token }));
  return file;
}
