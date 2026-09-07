// TEMPORARY — deliberately failing, to prove tools/merge-pr.mjs refuses.
// Removed in the next commit on this branch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
test('deliberately failing, to verify the merge gate', () => {
  assert.equal(1, 2, 'this is meant to fail');
});
