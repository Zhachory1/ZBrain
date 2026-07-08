import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

test('CLI query rejects unknown options', () => {
  const result = spawnSync(process.execPath, [bin, 'query', 'alpha', '--prject', 'zbrain', '--json'], { cwd: process.cwd(), encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.error.code, 'invalid_request');
  assert.match(parsed.error.message, /unknown option: --prject/);
});

test('CLI query reports invalid filter values as invalid_request', () => {
  const result = spawnSync(process.execPath, [bin, 'query', 'alpha', '--from-date', '2026-99-99', '--json'], { cwd: process.cwd(), encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.error.code, 'invalid_request');
  assert.match(parsed.error.message, /valid YYYY-MM-DD/);
});

test('CLI preflight and import target path', () => {
  const target = mkdtempSync(path.join(tmpdir(), 'zbrain-cli-import-'));
  mkdirSync(path.join(target, 'docs'), { recursive: true });
  writeFileSync(path.join(target, 'docs', 'note.md'), '# Note\n\nalpha needle\n');
  const preflight = spawnSync(process.execPath, [bin, 'preflight', target, '--json'], { cwd: process.cwd(), encoding: 'utf8' });
  assert.equal(preflight.status, 0, preflight.stderr);
  const preflightJson = JSON.parse(preflight.stdout);
  assert.equal(preflightJson.preflight.documents, 1);
  assert.equal(preflightJson.preflight.largestFiles[0].path, null);
  const preflightPaths = spawnSync(process.execPath, [bin, 'preflight', target, '--include-paths', '--json'], { cwd: process.cwd(), encoding: 'utf8' });
  assert.equal(preflightPaths.status, 0, preflightPaths.stderr);
  const pathValue = JSON.parse(preflightPaths.stdout).preflight.largestFiles[0].path;
  assert.equal(pathValue, 'docs/note.md');
  assert.ok(!path.isAbsolute(pathValue));
  const imported = spawnSync(process.execPath, [bin, 'import', target, '--json'], { cwd: process.cwd(), encoding: 'utf8' });
  assert.equal(imported.status, 0, imported.stderr);
  assert.equal(JSON.parse(imported.stdout).import.indexed.documents, 1);
  assert.match(readFileSync(path.join(target, '.gitignore'), 'utf8'), /^\.zbrain\/$/m);
  const query = spawnSync(process.execPath, [bin, 'query', 'alpha needle', '--json'], { cwd: target, encoding: 'utf8' });
  assert.equal(query.status, 0, query.stderr);
  assert.equal(JSON.parse(query.stdout).results[0].id, 'docs/note.md');
  rmSync(target, { recursive: true, force: true });
});
