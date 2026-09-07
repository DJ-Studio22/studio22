#!/usr/bin/env node
//
// tools/merge-pr.mjs — merge a pull request, but only if every check is green.
//
// WHY THIS EXISTS
// ---------------
// `gh pr merge` does not look at the checks. It will squash a pull request
// with a failing build without a word, and the repo's rulesets have an admin
// bypass, so nothing on the server refuses either. The only thing standing
// between a red check and `main` was somebody remembering to read the output
// of `gh pr checks` before typing the next command.
//
// On PR #16 that somebody did not. `main` carried a failing test suite for one
// commit, and the break was only found by running the suite locally afterwards
// for an unrelated reason. Discipline that is only a habit fails exactly when
// you are busy, which is exactly when it matters.
//
// So the gate is a program now:
//
//   node tools/merge-pr.mjs 42            merge PR 42 if it is green
//   node tools/merge-pr.mjs               merge the PR for the current branch
//
// It waits for pending checks, refuses on any failure, prints what failed, and
// exits non-zero. There is deliberately no --force: the way past a red check is
// to fix the branch.

import { spawnSync } from 'node:child_process';

const POLL_SECONDS = 10;
const MAX_WAIT_MINUTES = 20;

function gh(args, { quiet = false } = {}) {
  const run = spawnSync('gh', args, { encoding: 'utf8' });
  if (run.error) {
    console.error('Could not run gh. Is the GitHub CLI on PATH?');
    process.exit(2);
  }
  if (run.status !== 0 && !quiet) {
    process.stderr.write(run.stderr || '');
  }
  return { status: run.status, out: (run.stdout || '').trim() };
}

const argument = process.argv[2];
const target = argument ? [argument] : [];

// Which PR are we talking about? Ask gh rather than guessing from the branch,
// so a detached head or a renamed branch fails loudly instead of merging
// something else.
const view = gh(['pr', 'view', ...target, '--json', 'number,title,state,headRefName']);
if (view.status !== 0) {
  console.error('No pull request found. Pass a number, or run this on a branch with one open.');
  process.exit(2);
}
const pr = JSON.parse(view.out);
if (pr.state !== 'OPEN') {
  console.error(`PR #${pr.number} is ${pr.state}, not open.`);
  process.exit(2);
}

console.log(`PR #${pr.number}  ${pr.title}`);
console.log(`branch ${pr.headRefName}`);

const deadline = Date.now() + MAX_WAIT_MINUTES * 60_000;
let checks = [];

for (;;) {
  const result = gh(['pr', 'checks', String(pr.number), '--json', 'name,state,bucket'], { quiet: true });
  // `gh pr checks` exits non-zero when anything is failing OR pending, so the
  // exit code cannot be used to decide anything. The buckets can.
  checks = result.out ? JSON.parse(result.out) : [];

  if (!checks.length) {
    console.error('No checks reported for this PR. Refusing to merge something nothing has tested.');
    process.exit(1);
  }

  const pending = checks.filter((c) => c.bucket === 'pending');
  const failing = checks.filter((c) => c.bucket === 'fail' || c.bucket === 'cancel');

  if (failing.length) {
    console.error('\nREFUSING TO MERGE. These checks are not green:');
    for (const c of failing) console.error(`  ${c.bucket.toUpperCase().padEnd(7)} ${c.name}`);
    console.error('\nFix it on the branch and push again. There is no way past this.');
    process.exit(1);
  }

  if (!pending.length) break;

  if (Date.now() > deadline) {
    console.error(`\nStill pending after ${MAX_WAIT_MINUTES} minutes: `
      + pending.map((c) => c.name).join(', '));
    console.error('Refusing to merge on an unfinished run.');
    process.exit(1);
  }

  console.log(`waiting on ${pending.length} check(s): ${pending.map((c) => c.name).join(', ')}`);
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, POLL_SECONDS * 1000);
}

console.log('\nAll checks green:');
for (const c of checks) console.log(`  PASS    ${c.name}`);

const merge = gh(['pr', 'merge', String(pr.number), '--squash', '--delete-branch']);
if (merge.status !== 0) {
  console.error('gh pr merge failed.');
  process.exit(merge.status || 1);
}
console.log(`\nMerged #${pr.number}.`);
