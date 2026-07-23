import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { generateBrief } from '../src/brief.js';
import { indexProject, initProject } from '../src/store.js';

function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), 'zbrain-brief-'));
  mkdirSync(path.join(dir, 'inbox'), { recursive: true });
  mkdirSync(path.join(dir, 'sessions'), { recursive: true });
  writeFileSync(path.join(dir, 'inbox/2026-07-22-plan-alpha.md'), '# Plan Alpha\n\nStep one and step two.\n');
  writeFileSync(path.join(dir, 'sessions/2026-07-21-session-beta.md'), '# Session Beta\n\nDecisions made here.\n');
  writeFileSync(path.join(dir, 'sessions/2026-01-01-old.md'), '# Old Note\n\nStale content.\n');
  initProject({ cwd: dir, root: '.' });
  indexProject({ cwd: dir });
  return dir;
}

test('daily brief writes offline listing to corpus inbox by default', async () => {
  const dir = fixture();
  try {
    const result = await generateBrief({ cwd: dir, period: 'weekly', date: '2026-07-23' });
    assert.equal(result.written, true);
    assert.equal(result.source, 'offline-listing');
    assert.equal(result.path, path.join(dir, 'inbox', 'eow-2026-07-23.md'));
    const body = readFileSync(result.path, 'utf8');
    assert.match(body, /Plan Alpha/);
    assert.match(body, /Session Beta/);
    assert.doesNotMatch(body, /Old Note/); // outside 7-day window
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('empty window writes nothing', async () => {
  const dir = fixture();
  try {
    const result = await generateBrief({ cwd: dir, period: 'daily', date: '2020-01-01' });
    assert.equal(result.written, false);
    assert.equal(result.reason, 'empty');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('re-running same day overwrites, not duplicates', async () => {
  const dir = fixture();
  try {
    const a = await generateBrief({ cwd: dir, period: 'weekly', date: '2026-07-23' });
    const first = readFileSync(a.path, 'utf8');
    const b = await generateBrief({ cwd: dir, period: 'weekly', date: '2026-07-23' });
    assert.equal(b.path, a.path);
    assert.equal(readFileSync(b.path, 'utf8'), first);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('allowNetwork invokes configured agent and audits egress', async () => {
  const dir = fixture();
  try {
    const agentScript = path.join(dir, 'fake-agent.js');
    writeFileSync(agentScript, 'import { writeFileSync } from "node:fs";\nconst out = process.argv[process.argv.indexOf("--out") + 1];\nwriteFileSync(out, "# Prose Summary\\n\\nagent wrote this\\n");\n');
    const config = JSON.parse(readFileSync(path.join(dir, '.zbrain/config.json'), 'utf8'));
    config.briefings = { agent: { command: process.execPath, args: [agentScript, '--out', '{outFile}'] } };
    writeFileSync(path.join(dir, '.zbrain/config.json'), JSON.stringify(config, null, 2));
    const result = await generateBrief({ cwd: dir, period: 'weekly', date: '2026-07-23', allowNetwork: true });
    assert.equal(result.source, 'agent');
    assert.match(readFileSync(result.path, 'utf8'), /agent wrote this/);
    const audit = readFileSync(path.join(dir, '.zbrain/brief-audit.log'), 'utf8').trim();
    assert.match(audit, /"network":true/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('type filter narrows the brief', async () => {
  const dir = fixture();
  try {
    const result = await generateBrief({ cwd: dir, period: 'weekly', date: '2026-07-23', filters: { type: 'sessions' } });
    const body = readFileSync(result.path, 'utf8');
    assert.match(body, /Session Beta/);
    assert.doesNotMatch(body, /Plan Alpha/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
