import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Makes one AsyncStorage method reject for the duration of `body`, then puts it back.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Why this exists rather than `jest.spyOn(...).mockRestore()` ─────────────
 * The official AsyncStorage mock defines its methods as `jest.fn(impl)` — the in-memory store lives
 * in that implementation. `jest.spyOn` on an already-mocked function does not wrap it: it hands back
 * **the same mock object**, so `mockRestore()` has no replaced property to restore and does the only
 * other thing it can — reset the mock. That discards the implementation the factory supplied, and
 * `getMockImplementation()` becomes `undefined`.
 *
 * The failure is invisible where it happens. `setItem` still exists, still resolves, and returns
 * `undefined` — so a write reports success and stores nothing, and the test that reads it back gets
 * `null` several cases later. In `faith-preferences-store` that surfaced as "persists through storage
 * rather than only in memory" receiving `{}`, and in `onboarding-preferences` as five cases about
 * surviving a restart. Both passed in declared order and failed under `--randomize`. Issue #159.
 *
 * `jest.restoreAllMocks()` is safe by contrast, and measured to be: with no property ever replaced
 * there is nothing for it to restore, so the implementation survives it.
 *
 * ── What this guarantees ───────────────────────────────────────────────────
 *   - The rejection is real: the method rejects, so a failure path is exercised rather than mocked
 *     around.
 *   - A rejected write **cannot** mutate the store, because the implementation that would have
 *     written is replaced for the duration rather than wrapped.
 *   - The canonical implementation is read off the mock and put back, so it cannot drift from
 *     whatever the library ships.
 *   - A lifecycle error is reported rather than concealed: if the implementation is already missing
 *     when this is called, something earlier broke the mock and this says so by name.
 * ═══════════════════════════════════════════════════════════════════════════
 */
export type FailableStorageMethod = 'getItem' | 'setItem' | 'multiGet' | 'multiSet' | 'removeItem';

type StorageMock = jest.Mock & {
  getMockImplementation: () => ((...args: never[]) => unknown) | undefined;
};

export async function withAsyncStorageFailing<T>(
  method: FailableStorageMethod,
  error: Error,
  body: () => Promise<T>,
): Promise<T> {
  const mock = AsyncStorage[method] as unknown as StorageMock;
  const canonical = mock.getMockImplementation();
  if (canonical === undefined) {
    throw new Error(
      `AsyncStorage.${method} has no implementation to restore, so the in-memory store is already ` +
        'broken. Something called `mockRestore()` on it — see `async-storage-failure.ts`.',
    );
  }

  mock.mockImplementation((() => Promise.reject(error)) as never);
  try {
    return await body();
  } finally {
    mock.mockImplementation(canonical as never);
  }
}
