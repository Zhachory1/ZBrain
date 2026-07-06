import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const script = path.resolve('scripts/private-semantic-bm25.js');

test('private semantic runner rejects unsafe run id', () => {
  const result = spawnSync(process.execPath, [script, '--run-id', '../bad', '--report', '/tmp/unused.md'], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /run-id/);
});

test('invalid private manifest report does not expose missing relative paths', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'zbrain-m3a-root-'));
  const priv = mkdtempSync(path.join(tmpdir(), 'zbrain-m3a-private-'));
  const manifest = path.join(priv, 'manifest.json');
  const report = path.join(priv, 'report.md');
  const queries = [];
  for (const gapType of ['paraphrase', 'alias', 'conceptual', 'negative-near-miss']) {
    for (let i = 0; i < 3; i += 1) {
      queries.push({ id: `${gapType}-${i}`, class: 'fuzzy_memory', gapType, query: 'missing', expected: [`projects/secret-${gapType}-${i}.md`], negative: [`inbox/private-negative-${gapType}-${i}.md`] });
    }
  }
  writeFileSync(manifest, JSON.stringify({ schemaVersion: 1, corpusClass: 'private', corpusRoot: root, queries }));
  const result = spawnSync(process.execPath, [script, '--manifest', manifest, '--run-id', 'invalid-manifest-test', '--report', report], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  const text = readFileSync(report, 'utf8');
  assert.doesNotMatch(text, /projects\/secret/);
  assert.doesNotMatch(text, /inbox\/private-negative/);
  assert.match(text, /manifest shape invalid/);
});
