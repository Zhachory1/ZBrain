import test from 'node:test';
import assert from 'node:assert/strict';
import { isDeniedPath } from '../src/denylist.js';

test('denylist blocks secrets and generated paths', () => {
  assert.equal(isDeniedPath('repo/.git/config'), true);
  assert.equal(isDeniedPath('repo/.env'), true);
  assert.equal(isDeniedPath('repo/node_modules/pkg/index.js'), true);
  assert.equal(isDeniedPath('repo/docs/readme.md'), false);
});
