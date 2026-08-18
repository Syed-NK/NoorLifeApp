import { spawnSync } from 'node:child_process';

/**
 * Resolving the commit that protected files are compared against.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Why this exists ────────────────────────────────────────────────────────
 * The protection suites compared the working tree against a **local branch name**.
 * `actions/checkout` creates remote-tracking refs and the checked-out branch, and nothing else, so
 * `feature/core-module-framework` does not resolve on CI. `protected-files.test.ts` asserts its
 * baseline is reachable rather than skipping — deliberately, because a protection test that quietly
 * does nothing is worse than none — so the whole suite failed on the first PR that ran it.
 *
 * The failure was correct. What was wrong was assuming one ref name is reachable everywhere.
 *
 * ── The resolution order, and why it ends where it does ────────────────────
 *   1. the configured local branch  — a developer's own clone, where it is the natural baseline;
 *   2. `origin/<branch>`            — CI, where only remote-tracking refs exist;
 *   3. `PROTECTED_BASE_SHA`         — the same commit, pinned.
 *
 * The third is the one that actually makes this durable. A branch name is a moving, deletable label:
 * `feature/core-module-framework` has already been merged, and the day it is deleted both of the
 * first two candidates vanish together. The commit itself cannot move and cannot be deleted while it
 * is an ancestor of the default branch, which it now is.
 *
 * ── What this must never do ────────────────────────────────────────────────
 * Fail soft. If none of the three resolves, `resolveProtectedBaseline` throws, and the callers let it
 * throw. There is no environment check, no CI special case and no conditional skip — the point of the
 * suites this serves is to fail when they cannot do their job.
 *
 * `spawnSync` rather than `execFileSync` throughout, so a missing ref is an exit status to read
 * rather than an exception to catch. Nothing here needs a `try`, and so nothing here can swallow one.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** The branch the protection suites treat as the branch point. */
export const PROTECTED_BASE_BRANCH = 'feature/core-module-framework';

/**
 * The same commit as `PROTECTED_BASE_BRANCH`, pinned in full.
 *
 * Forty characters on purpose: an abbreviated hash is a prefix, and a prefix can become ambiguous as
 * a repository grows. Merged into the default branch as parent 2 of `0432d66`, so it stays reachable
 * even after the branch label is deleted.
 */
export const PROTECTED_BASE_SHA = 'a12c8cbe9a99f91a150c6c0ea2cd827e28297ead';

export type BaselineSource = 'local-branch' | 'remote-branch' | 'immutable-sha';

export type BaselineCandidate = {
  readonly ref: string;
  readonly source: BaselineSource;
};

export type ResolvedBaseline = BaselineCandidate;

/**
 * Exactly three, in order — a tuple rather than an array so a caller destructuring
 * `[local, remote, sha]` gets three defined candidates instead of three possibly-undefined ones.
 */
export type BaselineCandidateList = readonly [
  BaselineCandidate,
  BaselineCandidate,
  BaselineCandidate,
];

/** The three candidates, in the order they must be tried. */
export function baselineCandidates(
  branch: string = PROTECTED_BASE_BRANCH,
  sha: string = PROTECTED_BASE_SHA,
): BaselineCandidateList {
  return [
    { ref: branch, source: 'local-branch' },
    { ref: `origin/${branch}`, source: 'remote-branch' },
    { ref: sha, source: 'immutable-sha' },
  ];
}

/**
 * Whether a ref names a commit in this repository.
 *
 * `^{commit}` so a tag or a ref that resolves to another object type cannot pass as a baseline.
 */
export function gitRefResolves(ref: string): boolean {
  const probe = spawnSync('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], {
    encoding: 'utf8',
  });
  return probe.status === 0;
}

/**
 * The first candidate that resolves.
 *
 * Throws — loudly, naming every candidate it tried — when none does. Callers must not catch this.
 * The parameters exist so the ordering can be proven by test without mutating the repository's refs.
 */
export function resolveProtectedBaseline(
  candidates: readonly BaselineCandidate[] = baselineCandidates(),
  refResolves: (ref: string) => boolean = gitRefResolves,
): ResolvedBaseline {
  for (const candidate of candidates) {
    if (refResolves(candidate.ref)) {
      return candidate;
    }
  }

  const tried = candidates.map((c) => `${c.ref} (${c.source})`).join(', ');
  throw new Error(
    `Cannot resolve a baseline for the protected-file comparison. Tried, in order: ${tried}. ` +
      'The comparison is failed rather than skipped, because a protection suite that silently ' +
      'verifies nothing is worse than no protection suite.',
  );
}

/** One file as of `ref`, or `null` when the ref does not carry it. */
export function readBaselineFile(ref: string, filePath: string): string | null {
  const shown = spawnSync('git', ['show', `${ref}:${filePath}`], {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  return shown.status === 0 ? shown.stdout : null;
}
