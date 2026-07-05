import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { getDocument, indexProject, initProject, queryIndex, statusIndex } from '../src/store.js';

function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), 'zbrain-store-'));
  mkdirSync(path.join(dir, 'docs'), { recursive: true });
  writeFileSync(path.join(dir, 'docs', 'release.md'), '# Release Note\n\nLocal retrieval works with alpha needle.\n');
  writeFileSync(path.join(dir, 'docs', 'other.md'), '# Other\n\nNo matching phrase.\n');
  return dir;
}

test('init, index, query, get, status work', () => {
  const dir = fixture();
  initProject({ cwd: dir, root: './docs' });
  const indexed = indexProject({ cwd: dir });
  assert.equal(indexed.documents, 2);
  const query = queryIndex({ cwd: dir, query: 'alpha needle', limit: 5 });
  assert.equal(query.results[0].id, 'release.md');
  assert.equal(query.results[0].rank, 1);
  assert.equal(query.results[0].provenance.path, 'release.md');
  const got = getDocument({ cwd: dir, id: query.results[0].id, from: 1, lines: 2 });
  assert.match(got.document.content, /Release Note/);
  const status = statusIndex({ cwd: dir });
  assert.equal(status.status.documents, 2);
  assert.ok(status.status.chunks >= 2);
  rmSync(dir, { recursive: true, force: true });
});

test('get rejects chunk id', () => {
  const dir = fixture();
  initProject({ cwd: dir, root: './docs' });
  indexProject({ cwd: dir });
  assert.throws(() => getDocument({ cwd: dir, id: 'release.md#0' }), /chunk id/);
  rmSync(dir, { recursive: true, force: true });
});

test('rebuild removes deleted docs', () => {
  const dir = fixture();
  initProject({ cwd: dir, root: './docs' });
  indexProject({ cwd: dir });
  rmSync(path.join(dir, 'docs', 'release.md'));
  indexProject({ cwd: dir });
  const query = queryIndex({ cwd: dir, query: 'alpha needle', limit: 5 });
  assert.equal(query.results.length, 0);
  rmSync(dir, { recursive: true, force: true });
});

test('symlink escape under root is rejected/skipped', () => {
  const dir = fixture();
  const outside = mkdtempSync(path.join(tmpdir(), 'zbrain-outside-'));
  writeFileSync(path.join(outside, 'secret.md'), '# Secret\nprivatevalue secret\n');
  symlinkSync(path.join(outside, 'secret.md'), path.join(dir, 'docs', 'secret.md'));
  initProject({ cwd: dir, root: './docs' });
  assert.doesNotThrow(() => indexProject({ cwd: dir }));
  const query = queryIndex({ cwd: dir, query: 'privatevalue secret', limit: 5 });
  assert.equal(query.results.length, 0);
  rmSync(dir, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

test('query punctuation does not break FTS', () => {
  const dir = fixture();
  initProject({ cwd: dir, root: './docs' });
  indexProject({ cwd: dir });
  assert.doesNotThrow(() => queryIndex({ cwd: dir, query: `alpha'; DROP TABLE documents; --`, limit: 5 }));
  const status = statusIndex({ cwd: dir });
  assert.equal(status.status.documents, 2);
  rmSync(dir, { recursive: true, force: true });
});
