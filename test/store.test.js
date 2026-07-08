import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getDocument, importProject, indexProject, initProject, preflightProject, queryIndex, statusIndex } from '../src/store.js';

const bin = path.resolve('bin/zbrain.js');

function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), 'zbrain-store-'));
  mkdirSync(path.join(dir, 'docs'), { recursive: true });
  writeFileSync(path.join(dir, 'docs', 'release.md'), '# Release Note\n\nLocal retrieval works with alpha needle.\n');
  writeFileSync(path.join(dir, 'docs', 'login.md'), '# Login Help\n\nAuthentication cookies can break login.\n');
  writeFileSync(path.join(dir, 'docs', 'other.md'), '# Other\n\nNo matching phrase.\n');
  return dir;
}

test('preflight reports corpus shape and redacts paths by default', () => {
  const dir = fixture();
  mkdirSync(path.join(dir, '.zbrain'), { recursive: true });
  writeFileSync(path.join(dir, '.zbrain', 'hidden.md'), '# Hidden\nsecret\n');
  const preflight = preflightProject({ root: dir });
  assert.equal(preflight.preflight.documents, 3);
  assert.equal(preflight.preflight.skippedReasons.deniedPath, 1);
  assert.equal(preflight.preflight.largestFiles[0].path, null);
  const withPaths = preflightProject({ root: dir, includePaths: true });
  assert.match(withPaths.preflight.largestFiles[0].path, /docs\//);
  rmSync(dir, { recursive: true, force: true });
});

test('import indexes target without touching caller cwd', () => {
  const dir = fixture();
  const caller = mkdtempSync(path.join(tmpdir(), 'zbrain-caller-'));
  const result = importProject({ cwd: caller, target: dir });
  assert.equal(result.import.configAction, 'created');
  assert.equal(result.import.dbAction, 'created');
  assert.ok(existsSync(path.join(dir, '.zbrain/index.sqlite')));
  assert.ok(!existsSync(path.join(caller, '.zbrain')));
  assert.match(readFileSync(path.join(dir, '.gitignore'), 'utf8'), /^\.zbrain\/$/m);
  const query = queryIndex({ cwd: dir, query: 'alpha needle', limit: 5 });
  assert.equal(query.results[0].id, 'docs/release.md');
  rmSync(dir, { recursive: true, force: true });
  rmSync(caller, { recursive: true, force: true });
});

test('import reuses compatible config and preserves aliases', () => {
  const dir = fixture();
  mkdirSync(path.join(dir, '.zbrain'), { recursive: true });
  const embeddings = { provider: 'ollama', baseUrl: 'http://127.0.0.1:11434', model: 'mxbai-embed-large:latest' };
  writeFileSync(path.join(dir, '.zbrain/config.json'), JSON.stringify({ schemaVersion: 1, root: '.', aliases: { 'sign-in': ['login'] }, embeddings }, null, 2));
  const result = importProject({ target: dir });
  assert.equal(result.import.configAction, 'reused');
  const config = JSON.parse(readFileSync(path.join(dir, '.zbrain/config.json'), 'utf8'));
  assert.deepEqual(config.aliases, { 'sign-in': ['login'] });
  assert.deepEqual(config.embeddings, embeddings);
  assert.match(readFileSync(path.join(dir, '.gitignore'), 'utf8'), /^\.zbrain\/$/m);
  rmSync(dir, { recursive: true, force: true });
});

test('import rejects incompatible config without force', () => {
  const dir = fixture();
  initProject({ cwd: dir, root: './docs' });
  assert.throws(() => importProject({ target: dir }), /incompatible root/);
  rmSync(dir, { recursive: true, force: true });
});

test('import rejects existing index without force and backs it up with force', () => {
  const dir = fixture();
  importProject({ target: dir });
  assert.throws(() => importProject({ target: dir }), /index exists/);
  const forced = importProject({ target: dir, force: true });
  assert.equal(forced.import.dbAction, 'overwritten');
  assert.ok(forced.import.backups.dbPath);
  assert.ok(existsSync(path.join(dir, forced.import.backups.dbPath)));
  rmSync(dir, { recursive: true, force: true });
});

test('failed import on existing index does not create config but still enforces gitignore', () => {
  const dir = fixture();
  mkdirSync(path.join(dir, '.zbrain'), { recursive: true });
  writeFileSync(path.join(dir, '.zbrain/index.sqlite'), 'existing');
  assert.throws(() => importProject({ target: dir }), /index exists/);
  assert.ok(!existsSync(path.join(dir, '.zbrain/config.json')));
  assert.match(readFileSync(path.join(dir, '.gitignore'), 'utf8'), /^\.zbrain\/$/m);
  rmSync(dir, { recursive: true, force: true });
});

test('init, index, query, get, status work', () => {
  const dir = fixture();
  initProject({ cwd: dir, root: './docs' });
  const indexed = indexProject({ cwd: dir });
  assert.equal(indexed.documents, 3);
  const query = queryIndex({ cwd: dir, query: 'alpha needle', limit: 5 });
  assert.equal(query.results[0].id, 'release.md');
  assert.equal(query.results[0].rank, 1);
  assert.equal(query.results[0].provenance.path, 'release.md');
  const got = getDocument({ cwd: dir, id: query.results[0].id, from: 1, lines: 2 });
  assert.match(got.document.content, /Release Note/);
  const status = statusIndex({ cwd: dir });
  assert.equal(status.status.documents, 3);
  assert.ok(status.status.chunks >= 3);
  rmSync(dir, { recursive: true, force: true });
});

test('alias expansion works and no-aliases disables it', () => {
  const dir = fixture();
  initProject({ cwd: dir, root: './docs' });
  const config = JSON.parse(readFileSync(path.join(dir, '.zbrain/config.json'), 'utf8'));
  config.aliases = { 'sign-in': ['login', 'authentication'] };
  writeFileSync(path.join(dir, '.zbrain/config.json'), JSON.stringify(config, null, 2));
  indexProject({ cwd: dir });
  const withAlias = spawnSync(process.execPath, [bin, 'query', 'sign-in problem', '--json', '--explain'], { cwd: dir, encoding: 'utf8' });
  assert.equal(withAlias.status, 0, withAlias.stderr);
  const parsed = JSON.parse(withAlias.stdout);
  assert.equal(parsed.results[0].id, 'login.md');
  assert.equal(parsed.query.aliasesApplied[0].term, 'sign-in');
  const noAlias = spawnSync(process.execPath, [bin, 'query', 'sign-in problem', '--json', '--no-aliases'], { cwd: dir, encoding: 'utf8' });
  assert.equal(noAlias.status, 0, noAlias.stderr);
  assert.equal(JSON.parse(noAlias.stdout).results.length, 0);
  rmSync(dir, { recursive: true, force: true });
});

test('invalid aliases fail query but no-aliases still works', () => {
  const dir = fixture();
  initProject({ cwd: dir, root: './docs' });
  const config = JSON.parse(readFileSync(path.join(dir, '.zbrain/config.json'), 'utf8'));
  config.aliases = { bad: 'shape' };
  writeFileSync(path.join(dir, '.zbrain/config.json'), JSON.stringify(config, null, 2));
  indexProject({ cwd: dir });
  const bad = spawnSync(process.execPath, [bin, 'query', 'bad', '--json'], { cwd: dir, encoding: 'utf8' });
  assert.notEqual(bad.status, 0);
  const ok = spawnSync(process.execPath, [bin, 'query', 'alpha needle', '--json', '--no-aliases'], { cwd: dir, encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
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
  const query = queryIndex({ cwd: dir, query: 'privatevalue', limit: 5 });
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
  assert.equal(status.status.documents, 3);
  rmSync(dir, { recursive: true, force: true });
});
