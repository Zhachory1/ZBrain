import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { initProject, queryIndex } from '../src/store.js';
import { watchProject } from '../src/watch.js';

function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), 'zbrain-watch-'));
  mkdirSync(path.join(dir, 'docs'), { recursive: true });
  writeFileSync(path.join(dir, 'docs', 'base.md'), '# Base\n\nbase needle\n');
  initProject({ cwd: dir, root: './docs' });
  return dir;
}

test('watch --once indexes uncommitted new markdown', async () => {
  const dir = fixture();
  try {
    writeFileSync(path.join(dir, 'docs', 'new.md'), '# New\n\nnewneedle\n');
    const result = await watchProject({ target: dir, once: true });
    assert.equal(result.watch.indexed.documents, 2);
    assert.equal(queryIndex({ cwd: dir, query: 'newneedle' }).results[0].id, 'new.md');
    assert.ok(existsSync(path.join(dir, '.zbrain/watch.log')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('watch --once updates edited markdown', async () => {
  const dir = fixture();
  try {
    await watchProject({ target: dir, once: true });
    writeFileSync(path.join(dir, 'docs', 'base.md'), '# Base\n\nupdatedneedle\n');
    const result = await watchProject({ target: dir, once: true });
    assert.equal(result.watch.indexed.changed, 1);
    assert.equal(queryIndex({ cwd: dir, query: 'updatedneedle' }).results[0].id, 'base.md');
    assert.equal(queryIndex({ cwd: dir, query: 'needle' }).results.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('watch --embed-stale requires --once', async () => {
  const dir = fixture();
  try {
    await assert.rejects(() => watchProject({ target: dir, embedStale: true }), /requires --once/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('watch --once removes deleted markdown from index', async () => {
  const dir = fixture();
  try {
    await watchProject({ target: dir, once: true });
    rmSync(path.join(dir, 'docs', 'base.md'));
    const result = await watchProject({ target: dir, once: true });
    assert.equal(result.watch.indexed.deleted, 1);
    assert.equal(queryIndex({ cwd: dir, query: 'needle' }).results.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
