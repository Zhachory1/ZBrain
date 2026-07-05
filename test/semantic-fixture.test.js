import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

test('semantic fixture covers required gap types and valid references', () => {
  const manifest = JSON.parse(readFileSync('fixtures/semantic/manifest.json', 'utf8'));
  const corpusRoot = path.resolve('fixtures/semantic', manifest.corpusRoot);
  assert.equal(manifest.queries.length >= 12, true);
  const counts = Object.create(null);
  const ids = new Set();
  for (const query of manifest.queries) {
    assert.equal(ids.has(query.id), false, `duplicate ${query.id}`);
    ids.add(query.id);
    counts[query.gapType] = (counts[query.gapType] || 0) + 1;
    assert.equal(Array.isArray(query.negative) && query.negative.length > 0, true, `${query.id} missing negative`);
    assert.equal(['lexical', 'alias', 'semantic', 'unknown'].includes(query.missCategoryHypothesis), true, `${query.id} bad hypothesis`);
    for (const doc of [...query.expected, ...query.negative]) assert.equal(existsSync(path.join(corpusRoot, doc)), true, `${query.id} missing ${doc}`);
    for (const term of query.expectedSnippetTerms || []) {
      const found = query.expected.some((doc) => readFileSync(path.join(corpusRoot, doc), 'utf8').toLowerCase().includes(String(term).toLowerCase()));
      assert.equal(found, true, `${query.id} missing snippet term ${term}`);
    }
  }
  for (const type of ['paraphrase', 'alias', 'conceptual', 'negative-near-miss']) {
    assert.equal((counts[type] || 0) >= 3, true, `${type} under-covered`);
  }
});
