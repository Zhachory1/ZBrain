import test from 'node:test';
import assert from 'node:assert/strict';
import { negativeRankOf, rankOf, snippetUseful, summarizeRows } from '../src/metrics.js';

test('rankOf finds expected path', () => {
  assert.equal(rankOf(['a.md'], [{ path: 'b.md' }, { path: 'a.md' }]), 2);
  assert.equal(rankOf(['missing.md'], [{ path: 'b.md' }]), null);
});

test('negativeRankOf finds forbidden path', () => {
  assert.equal(negativeRankOf(['bad.md'], [{ path: 'bad.md' }]), 1);
  assert.equal(negativeRankOf(['bad.md'], [{ path: 'good.md' }]), null);
});

test('snippetUseful checks required terms', () => {
  assert.equal(snippetUseful({ snippet: 'bound concurrency and retry once' }, ['bound concurrency', 'retry once']), true);
  assert.equal(snippetUseful({ snippet: 'unrelated' }, ['retry once']), false);
});

test('summarizeRows computes recall, negative hits, and latency', () => {
  const summary = summarizeRows([
    { rank: 1, negativeRank: null, snippetUseful: true, latencyMs: 10, error: null },
    { rank: 4, negativeRank: 2, snippetUseful: false, latencyMs: 20, error: null },
    { rank: null, negativeRank: null, snippetUseful: false, latencyMs: 30, error: 'x' },
  ]);
  assert.equal(summary.recallAt1, 1 / 3);
  assert.equal(summary.recallAt3, 1 / 3);
  assert.equal(summary.recallAt10, 2 / 3);
  assert.equal(summary.negativeHitAt10, 1 / 3);
  assert.equal(summary.snippetUsefulRate, 1 / 3);
  assert.equal(summary.failureRate, 1 / 3);
});
