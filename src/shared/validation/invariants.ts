/**
 * Small runtime invariant helpers.
 *
 * Used where TypeScript cannot express a constraint — array-shape checks,
 * exhaustiveness at a switch's end, and narrowing after an index access under
 * `noUncheckedIndexedAccess`.
 *
 * Deliberately not a validation library: Phase 1 has no forms and no external
 * data to parse, so a schema dependency would have nothing to validate. Form
 * validation (§27) arrives with the auth screens in Phase 2.
 */

/** Throws with `message` when `condition` is false. */
export function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`NoorLife invariant failed: ${message}`);
  }
}

/**
 * Asserts a value is present, and narrows away `null | undefined`.
 *
 * Useful after an indexed access, which `noUncheckedIndexedAccess` widens.
 */
export function required<T>(value: T | null | undefined, name: string): T {
  if (value === null || value === undefined) {
    throw new Error(`NoorLife invariant failed: ${name} is required but was ${String(value)}`);
  }
  return value;
}

/**
 * Compile-time exhaustiveness guard.
 *
 * Place in a switch's `default`: if a union gains a member, the call stops
 * compiling.
 */
export function assertNever(value: never, context: string): never {
  throw new Error(`NoorLife reached an unreachable case in ${context}: ${JSON.stringify(value)}`);
}

/** Asserts an array has exactly `length` items and narrows it to a tuple-ish read. */
export function assertLength<T>(items: readonly T[], length: number, name: string): readonly T[] {
  if (items.length !== length) {
    throw new Error(
      `NoorLife invariant failed: ${name} must have exactly ${length} items, found ${items.length}`,
    );
  }
  return items;
}
