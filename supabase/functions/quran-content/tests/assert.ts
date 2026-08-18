/**
 * A handful of assertions, written locally rather than imported.
 *
 * The AI-2 suite runs as `deno test --no-remote --no-npm` with no `--allow-net`, which is not a style
 * choice: it is the strongest available statement of §J's precondition that these tests need "no network
 * and no key". A remote `@std/assert` import would need the network at least once to populate a cache, and
 * a suite whose green result depends on a download is a suite that cannot be run from a clean checkout on
 * a machine with no internet — which is exactly the environment the AI-2 acceptance criteria describe.
 *
 * Six functions is a small price for that.
 */

export class AssertionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssertionError';
  }
}

function show(value: unknown): string {
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  if (typeof a !== typeof b || a === null || b === null) {
    return false;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return false;
    }
    return a.every((entry, index) => deepEqual(entry, b[index]));
  }
  if (typeof a === 'object') {
    const left = a as Record<string, unknown>;
    const right = b as Record<string, unknown>;
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    if (!deepEqual(leftKeys, rightKeys)) {
      return false;
    }
    return leftKeys.every((key) => deepEqual(left[key], right[key]));
  }
  return false;
}

/**
 * Declared as an assertion signature, so `assert(file !== undefined, …)` narrows.
 *
 * Without `asserts condition` every `Array.prototype.find` result in the scan tests would need a non-null
 * assertion afterwards — and `!` in a test that exists to prove a file is present is exactly the operator that
 * would make the test pass when the file is missing.
 */
export function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new AssertionError(message);
  }
}

export function assertEquals(actual: unknown, expected: unknown, message?: string): void {
  if (!deepEqual(actual, expected)) {
    throw new AssertionError(
      `${message ?? 'values differ'}\n  expected: ${show(expected)}\n  actual:   ${show(actual)}`,
    );
  }
}

export function assertIncludes(haystack: string, needle: string, message?: string): void {
  if (!haystack.includes(needle)) {
    throw new AssertionError(`${message ?? 'missing substring'}: ${show(needle)}`);
  }
}

export function assertExcludes(haystack: string, needle: string, message?: string): void {
  if (haystack.includes(needle)) {
    throw new AssertionError(`${message ?? 'forbidden substring present'}: ${show(needle)}`);
  }
}

export function assertMatches(value: string, pattern: RegExp, message?: string): void {
  if (!pattern.test(value)) {
    throw new AssertionError(
      `${message ?? 'pattern did not match'} ${String(pattern)}: ${show(value)}`,
    );
  }
}

export function assertDoesNotMatch(value: string, pattern: RegExp, message?: string): void {
  if (pattern.test(value)) {
    throw new AssertionError(`${message ?? 'pattern matched and must not'} ${String(pattern)}`);
  }
}
