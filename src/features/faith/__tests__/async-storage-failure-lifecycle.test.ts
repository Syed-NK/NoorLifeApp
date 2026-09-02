import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import AsyncStorage from '@react-native-async-storage/async-storage';

import { withAsyncStorageFailing } from '@/test-support/async-storage-failure';

/**
 * A simulated storage failure must not outlive the case that asked for it — issue #159.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * `jest.spyOn` on an already-mocked function returns the same mock, so `mockRestore()` resets it and
 * discards the implementation that holds the in-memory store. `setItem` then resolves and writes
 * nothing: the write reports success, and a *later* case reading it back gets `null`. Two suites were
 * failing that way under `--randomize` — `faith-preferences-store` on persistence, and
 * `onboarding-preferences` on surviving a restart.
 *
 * ── Why the pair, and why each asserts before it fails anything ─────────────
 * A single "the mock still works" case is not a regression test: shuffled ahead of the case that
 * breaks the mock, it passes for the wrong reason. Both cases below use the failure helper *and*
 * assert a clean round-trip first, so whichever runs second is the one that catches an inherited
 * broken implementation. That makes the file fail in **either** order rather than at some seeds.
 * ═══════════════════════════════════════════════════════════════════════════
 */

type StorageMock = jest.Mock & { getMockImplementation: () => unknown };

const KEY = 'noorlife.test.storage-failure-lifecycle';

async function assertStoreWorks(label: string): Promise<void> {
  expect(`${label}: setItem has an implementation`).toBe(
    `${label}: ${typeof (AsyncStorage.setItem as unknown as StorageMock).getMockImplementation() === 'function' ? 'setItem has an implementation' : 'setItem was reset'}`,
  );
  await AsyncStorage.setItem(KEY, 'round-trip');
  expect(await AsyncStorage.getItem(KEY)).toBe('round-trip');
}

it('rejects, leaves the store untouched, and the next write still persists', async () => {
  await assertStoreWorks('first case');

  await AsyncStorage.setItem(KEY, 'before the failure');

  /* The rejection is real, and it is the caller who sees it. */
  await withAsyncStorageFailing('setItem', new Error('no space'), async () => {
    await expect(AsyncStorage.setItem(KEY, 'must not land')).rejects.toThrow('no space');
  });

  /* A rejected write cannot mutate the store: the implementation that would have written is gone. */
  expect(await AsyncStorage.getItem(KEY)).toBe('before the failure');

  /* And the very next write reaches the device again. */
  await AsyncStorage.setItem(KEY, 'after the failure');
  expect(await AsyncStorage.getItem(KEY)).toBe('after the failure');
});

it('cannot inherit a broken implementation from the case that failed a write', async () => {
  await assertStoreWorks('second case');

  await withAsyncStorageFailing('getItem', new Error('unavailable'), async () => {
    await expect(AsyncStorage.getItem(KEY)).rejects.toThrow('unavailable');
  });

  await AsyncStorage.setItem(KEY, 'still writable');
  expect(await AsyncStorage.getItem(KEY)).toBe('still writable');
});

it('reports a store that is already broken rather than papering over it', async () => {
  const mock = AsyncStorage.removeItem as unknown as StorageMock;
  const canonical = mock.getMockImplementation() as (...args: never[]) => unknown;
  mock.mockReset();
  try {
    await expect(
      withAsyncStorageFailing('removeItem', new Error('x'), async () => undefined),
    ).rejects.toThrow(/no implementation to restore/);
  } finally {
    mock.mockImplementation(canonical as never);
  }
});

it('no suite restores a spy over the device store', () => {
  /*
    The needles are assembled so this file does not satisfy its own scan: written whole, they would
    match the very strings being searched for.
  */
  const spyNeedle = ['spyOn(', 'AsyncStorage'].join('');
  const restoreNeedle = ['.mock', 'Restore('].join('');

  const files: string[] = [];
  (function walk(dir: string): void {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.test\.tsx?$/.test(path)) files.push(path);
    }
  })('src');

  const offenders = files.filter((path) => {
    const source = readFileSync(path, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    return source.includes(spyNeedle) && source.includes(restoreNeedle);
  });

  expect(files.length).toBeGreaterThan(300);
  expect(offenders).toEqual([]);
});
