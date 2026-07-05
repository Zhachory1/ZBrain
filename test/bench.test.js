import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadManifest, runBenchmark } from '../src/bench.js';

test('synthetic benchmark retrieves expected docs and measures gates', async () => {
  const { rows, indexStats } = await runBenchmark({ manifestPath: 'fixtures/synthetic/manifest.json', mode: 'bm25' });
  assert.equal(rows.length, 6);
  assert.equal(rows.every((r) => r.rank === 1), true);
  assert.equal(rows.every((r) => r.negativeRank === null), true);
  assert.equal(rows.every((r) => typeof r.snippetUseful === 'boolean'), true);
  assert.equal(indexStats.documents, 7);
  assert.ok(indexStats.totalBytes > 0);
  assert.ok(indexStats.runMs >= indexStats.buildMs);
});

test('manifest requires explicit corpusClass', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'zbrain-manifest-'));
  const manifest = path.join(dir, 'manifest.json');
  writeFileSync(manifest, JSON.stringify({ schemaVersion: 1, queries: [] }));
  assert.throws(() => loadManifest(manifest), /suiteId|corpusClass/);
});

test('manifest rejects unapproved query classes', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'zbrain-manifest-'));
  const manifest = path.join(dir, 'manifest.json');
  writeFileSync(manifest, JSON.stringify({
    schemaVersion: 1,
    suiteId: 'private-test',
    corpusClass: 'private',
    queries: [{ id: 'q', class: 'projects/secret-path', query: 'secret', expected: ['x.md'] }],
  }));
  assert.throws(() => loadManifest(manifest), /invalid query class/);
});

test('synthetic manifest cannot index outside manifest directory', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'zbrain-corpus-root-'));
  const manifest = path.join(dir, 'manifest.json');
  writeFileSync(manifest, JSON.stringify({
    schemaVersion: 1,
    suiteId: 'escape-test',
    corpusClass: 'synthetic',
    corpusRoot: '..',
    queries: [{ id: 'q', class: 'exact_lookup', query: 'secret', expected: ['secret.md'] }],
  }));
  await assert.rejects(() => runBenchmark({ manifestPath: manifest, mode: 'bm25' }), /corpusRoot/);
});

test('synthetic manifest cannot escape through corpusRoot symlink', async () => {
  const publicDir = mkdtempSync(path.join(tmpdir(), 'zbrain-public-'));
  const privateDir = mkdtempSync(path.join(tmpdir(), 'zbrain-private-'));
  writeFileSync(path.join(privateDir, 'secret.md'), '# Secret\nneedle-private-value');
  symlinkSync(privateDir, path.join(publicDir, 'docs'));
  const manifest = path.join(publicDir, 'manifest.json');
  writeFileSync(manifest, JSON.stringify({
    schemaVersion: 1,
    suiteId: 'symlink-test',
    corpusClass: 'synthetic',
    corpusRoot: 'docs',
    queries: [{ id: 'q', class: 'exact_lookup', query: 'needle-private-value', expected: ['secret.md'] }],
  }));
  await assert.rejects(() => runBenchmark({ manifestPath: manifest, mode: 'bm25' }), /corpusRoot/);
});
