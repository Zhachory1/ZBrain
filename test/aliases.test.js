import test from 'node:test';
import assert from 'node:assert/strict';
import { expandAliases, validateAliases } from '../src/aliases.js';

test('exact phrase alias expands', () => {
  const result = expandAliases('sign-in issue', { 'sign-in': ['login', 'authentication'] });
  assert.deepEqual(result.aliasesApplied, [{ term: 'sign-in', expanded: ['login', 'authentication'] }]);
  assert.match(result.expandedQuery, /login/);
});

test('non-adjacent alias terms do not expand', () => {
  const result = expandAliases('sign quickly in issue', { 'sign in': ['login'] });
  assert.deepEqual(result.aliasesApplied, []);
});

test('alias validation rejects bad shape', () => {
  assert.throws(() => validateAliases([]), /object/);
  assert.throws(() => validateAliases({ a: 'b' }), /array/);
  assert.throws(() => validateAliases({ a: [1] }), /string/);
});
