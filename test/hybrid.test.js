import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyIntent, mergeHybridResults, reciprocalRankFusion } from '../src/hybrid.js';

test('classifyIntent separates broad and exact queries', () => {
  assert.equal(classifyIntent('papers about quantum materials'), 'broad');
  assert.equal(classifyIntent('session 2026-06-30 mewrite release'), 'exact');
  assert.equal(classifyIntent('ADSB-1166 regional SAT rollout'), 'exact');
});

test('reciprocalRankFusion combines source ranks', () => {
  const fused = reciprocalRankFusion({ bm25: [{ id: 'a' }, { id: 'b' }], vector: [{ id: 'b' }, { id: 'c' }] }, { bm25: 1, vector: 1 });
  assert.equal(fused[0].id, 'b');
  assert.deepEqual(fused[0].sourceRanks, { bm25: 2, vector: 1 });
});

test('mergeHybridResults preserves bm25 result fields when available', () => {
  const results = mergeHybridResults({ bm25: [{ id: 'a', snippet: 'bm25' }], vector: [{ id: 'a', snippet: 'vector' }] });
  assert.equal(results[0].snippet, 'bm25');
});
