import fs from 'node:fs';
import path from 'node:path';

import {
  PROTECTED_BASE_BRANCH,
  PROTECTED_BASE_SHA,
  baselineCandidates,
  gitRefResolves,
  readBaselineFile,
  resolveProtectedBaseline,
} from '../../../test-support/protected-baseline';

/**
 * The baseline resolver the protected-file suites depend on.
 *
 * These tests exist because the previous resolver looked up a **local branch name**, which does not
 * exist under `actions/checkout`. The protection suite asserted rather than skipped, so it failed on
 * CI — correctly. What follows pins the replacement's ordering, and pins the property that made the
 * original failure the right behaviour: an unresolvable baseline stays a hard failure.
 *
 * Ordering is proven by injecting which refs resolve, rather than by creating and deleting refs in
 * the repository. A test that mutates refs to prove a point can leave the repository changed when it
 * fails.
 */

const CANDIDATES = baselineCandidates();
const [LOCAL, REMOTE, SHA] = CANDIDATES;

function onlyResolves(...refs: readonly string[]): (ref: string) => boolean {
  return (ref) => refs.includes(ref);
}

describe('protected baseline resolution order', () => {
  it('offers exactly the three documented candidates, in order', () => {
    expect(CANDIDATES.map((c) => c.source)).toEqual([
      'local-branch',
      'remote-branch',
      'immutable-sha',
    ]);
    expect(LOCAL.ref).toBe(PROTECTED_BASE_BRANCH);
    expect(REMOTE.ref).toBe(`origin/${PROTECTED_BASE_BRANCH}`);
    expect(SHA.ref).toBe(PROTECTED_BASE_SHA);
  });

  it('1. resolves the local branch when it is present', () => {
    const resolved = resolveProtectedBaseline(CANDIDATES, onlyResolves(LOCAL.ref));
    expect(resolved).toEqual({ ref: PROTECTED_BASE_BRANCH, source: 'local-branch' });
  });

  it('1. prefers the local branch even when every candidate would resolve', () => {
    const resolved = resolveProtectedBaseline(CANDIDATES, () => true);
    expect(resolved.source).toBe('local-branch');
  });

  it('2. falls back to the remote-tracking ref when the local branch is absent', () => {
    const resolved = resolveProtectedBaseline(CANDIDATES, onlyResolves(REMOTE.ref, SHA.ref));
    expect(resolved).toEqual({ ref: `origin/${PROTECTED_BASE_BRANCH}`, source: 'remote-branch' });
  });

  it('3. falls back to the immutable SHA when both branch refs are absent', () => {
    const resolved = resolveProtectedBaseline(CANDIDATES, onlyResolves(SHA.ref));
    expect(resolved).toEqual({ ref: PROTECTED_BASE_SHA, source: 'immutable-sha' });
  });

  it('4. total failure throws, and names every candidate it tried', () => {
    expect(() => resolveProtectedBaseline(CANDIDATES, () => false)).toThrow(
      /Cannot resolve a baseline/,
    );

    let message = '';
    try {
      resolveProtectedBaseline(CANDIDATES, () => false);
    } catch (error) {
      message = (error as Error).message;
    }
    for (const candidate of CANDIDATES) {
      expect(message).toContain(candidate.ref);
      expect(message).toContain(candidate.source);
    }
  });

  it('the pinned SHA is a full 40-character hash, not an abbreviation', () => {
    expect(PROTECTED_BASE_SHA).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe('the baseline is genuinely usable in this checkout', () => {
  it('resolves against the real repository', () => {
    const resolved = resolveProtectedBaseline();
    expect(['local-branch', 'remote-branch', 'immutable-sha']).toContain(resolved.source);
  });

  it('the pinned SHA resolves here, so the last fallback is not theoretical', () => {
    expect(gitRefResolves(PROTECTED_BASE_SHA)).toBe(true);
  });

  it('a protected file reads back from the pinned SHA, so comparisons can execute', () => {
    const baseline = readBaselineFile(
      PROTECTED_BASE_SHA,
      'src/features/entry-auth/entry-auth-copy.ts',
    );
    expect(baseline).not.toBeNull();
    expect((baseline as string).length).toBeGreaterThan(0);
  });

  it('every protected path resolves from the pinned SHA, not just one sample', () => {
    const suite = fs.readFileSync(
      path.join(process.cwd(), 'src/features/faith/__tests__/protected-files.test.ts'),
      'utf8',
    );
    const paths = [...suite.matchAll(/'(src\/[^']+\.tsx?)'/g)]
      .map((m) => m[1])
      .filter((p): p is string => typeof p === 'string');
    expect(paths.length).toBeGreaterThan(10);

    const unreadable = paths.filter((p) => readBaselineFile(PROTECTED_BASE_SHA, p) === null);
    expect(unreadable).toEqual([]);
  });
});

describe('the protection suite cannot be made to pass vacuously', () => {
  const suite = fs.readFileSync(
    path.join(process.cwd(), 'src/features/faith/__tests__/protected-files.test.ts'),
    'utf8',
  );

  it('contains no skipped, focused or pending test', () => {
    expect(suite).not.toMatch(/\b(describe|it|test)\.(skip|only|todo)\b/);
    expect(suite).not.toMatch(/\b(xdescribe|xit|fdescribe|fit)\(/);
  });

  it('has no catch clause, so an unresolvable baseline cannot be swallowed', () => {
    // A `catch` *clause*, not the word. The prose above the suite uses "catch" in its ordinary
    // sense, and matching that would make this a nuisance rather than a guard.
    expect(suite).not.toMatch(/\bcatch\s*[({]/);
  });

  it('does not early-return out of a comparison', () => {
    expect(suite).not.toMatch(/if \(!available\)/);
    expect(suite).not.toMatch(/^\s*return;\s*$/m);
  });

  it('still asserts file content against the baseline', () => {
    expect(suite).toContain('readBaselineFile(ref, filePath)');
    expect(suite).toContain(
      'expect(normalise(current)).toBe(normalise(baselineContent as string))',
    );
  });
});
