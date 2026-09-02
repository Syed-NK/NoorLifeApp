import AsyncStorage from '@react-native-async-storage/async-storage';

import { faithAddress } from '@/test-support/faith-storage-address';

/**
 * No case inherits another's writes — issue #158.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * The in-memory AsyncStorage mock is one object per worker, so a suite that writes a bookmark or a
 * reading position keeps it for every case that follows. That is not hypothetical: Faith Home has a
 * case that seeds a reading position and a sibling that asserts where Continue goes with **no**
 * position stored. The pair passed only while the seeding case happened to run second, and
 * `--randomize` turned it into `Expected "/faith/quran", received /faith/reader/[surah]` with
 * `{surah: 18, ayah: 32}` — the neighbour's data, arriving as a routing failure.
 *
 * ── Why two cases that mirror each other ────────────────────────────────────
 * A single "storage starts empty" case is not a regression test: shuffled ahead of whatever writes,
 * it passes on an empty store for the wrong reason. Each case here writes its own sentinel and
 * asserts the *other's* is absent, so whichever runs second is the one that catches an uncleared
 * store. Removing the clear from `jest.setup.ts` fails this file in **either** order, which is what
 * makes it deterministic rather than seed-dependent.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const FIRST = 'noorlife.test.isolation-sentinel.first';
const SECOND = 'noorlife.test.isolation-sentinel.second';

it('starts without the other case’s sentinel, and leaves its own', async () => {
  expect(await AsyncStorage.getItem(SECOND)).toBeNull();
  await AsyncStorage.setItem(FIRST, 'written by the first case');
});

it('starts without the first case’s sentinel, and leaves its own', async () => {
  expect(await AsyncStorage.getItem(FIRST)).toBeNull();
  await AsyncStorage.setItem(SECOND, 'written by the second case');
});

/*
  The same property at the address that actually caused #158, so a future change that exempts Faith's
  own namespace from the clear is caught here rather than in a routing assertion three suites away.
*/
it('starts without a reading position, whatever an earlier case stored', async () => {
  expect(await AsyncStorage.getItem(faithAddress('readingPosition'))).toBeNull();
  await AsyncStorage.setItem(
    faithAddress('readingPosition'),
    JSON.stringify({ surah: 18, surahName: 'Al-Kahf', ayah: 32, ayahCount: 110, progress: 0.29 }),
  );
});

it('still starts without a reading position after the case that stored one', async () => {
  expect(await AsyncStorage.getItem(faithAddress('readingPosition'))).toBeNull();
});
