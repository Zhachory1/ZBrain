import test from 'node:test';
import assert from 'node:assert/strict';
import { assertRepoSafePrivateReport, makeReport } from '../src/redaction.js';
import { writeReports } from '../src/bench.js';

test('private reports are aggregate only', () => {
  const report = makeReport({
    manifest: { corpusClass: 'private' },
    mode: 'bm25',
    rows: [{ id: 'q1', class: 'exact', rank: 1, negativeRank: null, snippetUseful: true, latencyMs: 1, error: null, query: 'secret', expected: ['private.md'], snippet: 'secret' }],
  });
  assert.equal(report.rows, undefined);
  assert.doesNotThrow(() => assertRepoSafePrivateReport(report));
});

test('repo-safe private reports reject forbidden fields', () => {
  assert.throws(() => assertRepoSafePrivateReport({ corpusClass: 'private', queryIdHash: 'abc' }), /unapproved field|unsafe/);
  assert.throws(() => assertRepoSafePrivateReport({ corpusClass: 'private', rows: [] }), /unapproved field/);
  assert.throws(() => assertRepoSafePrivateReport({ corpusClass: 'private', mode: 'bm25', suite: { suiteId: 'secret path/leak' }, metrics: {}, byClass: {}, indexStats: {} }), /unsafe/);
});

test('private repo-bound output requires explicit aggregate-output approval', () => {
  assert.throws(() => writeReports({
    manifest: { corpusClass: 'private' },
    mode: 'bm25',
    rows: [{ id: 'q1', class: 'exact', rank: 1, negativeRank: null, snippetUseful: true, latencyMs: 1, error: null }],
    jsonPath: '.cache/private.json',
    cwd: process.cwd(),
  }), /requires --allow-repo-aggregate-output/);
});

test('private outside-repo aggregate output is allowed after redaction checks', () => {
  assert.doesNotThrow(() => writeReports({
    manifest: { corpusClass: 'private' },
    mode: 'bm25',
    rows: [{ id: 'q1', class: 'exact', rank: 1, negativeRank: null, snippetUseful: true, latencyMs: 1, error: null }],
    jsonPath: `${process.env.HOME}/.zbrain/evals/private-docs/runs/test/private-aggregate.json`,
    cwd: process.cwd(),
  }));
});
