import AsyncStorage from '@react-native-async-storage/async-storage';
import { cleanup, render, fireEvent, screen, waitFor } from '@testing-library/react-native';
import React from 'react';

import { warmUpFirstMount } from '@/test-support/mock-latency-timers';

import { createMockFaithRepositories } from '../data/mock';
import { MAX_TASBIH_TARGET, MIN_TASBIH_TARGET } from '../data/tasbih.repository';
import { FaithRepositoryProvider } from '../di/faith-repository-context';
import { TasbihScreen } from '../screens/tasbih-screen';
import { faithAddress } from '@/test-support/faith-storage-address';

/**
 * The tasbih counter: haptics, the three renderings, and the concurrency guarantees.
 *
 * ── Why this is a second file rather than a longer one ──────────────────────
 * Split from `faith-tasbih.test.tsx` on evidence, not taste. Past roughly fifteen mounted-and-torn-
 * down screens in one suite, every subsequent render in this project's RNTL setup comes back empty —
 * the queries find nothing and the failure looks like a broken component rather than an exhausted
 * harness. Each of these cases passes on its own and passed in the combined file until it crossed
 * that line.
 *
 * Splitting is the honest fix: it keeps every assertion, costs one file, and means neither suite is
 * near the boundary. If a third group of tasbih cases is ever added, it gets a third file rather
 * than pushing one of these back over it.
 */
/*
  Real timers, for the reason `faith-interactions.test.tsx` records: these screens become ready
  through promise chains rather than through a timer, and under fake timers `waitFor` exhausts its
  simulated budget in microseconds before those chains settle.
*/
warmUpFirstMount(() => renderTasbih());

/**
 * A session is seeded rather than left to be created on mount.
 *
 * The counter genuinely persists — that is the feature — so a count left by one case would be the
 * starting state of the next, and the clear is essential. Seeding on top of it is a *speed*
 * decision: with no stored session the screen has to run `listPresets`, `getSession` and then
 * `startSession`, three round-trips through a repository that sleeps 280 ms each on purpose, which
 * lands past the default query budget. Seeding removes one of the three and makes every case start
 * from a stated, identical position.
 */
async function seedSession(overrides: Record<string, unknown> = {}): Promise<void> {
  await AsyncStorage.setItem(
    faithAddress('tasbihSession'),
    JSON.stringify({
      presetId: 'subhanallah',
      count: 0,
      rounds: 0,
      target: 33,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...overrides,
    }),
  );
}

/**
 * Every tree is unmounted before the next case seeds storage.
 *
 * Several cases render twice — that is how "does it survive a remount" is asked — so trees
 * accumulate, and a screen still mounted from the previous case keeps its repository alive and
 * keeps writing. Its writes then land on top of the next case's fresh seed, which surfaces several
 * tests later as a counter stuck on "Preparing". Unmounting first makes each case start from the
 * state it actually set up.
 */
beforeEach(async () => {
  await AsyncStorage.clear();
  await seedSession();
});

/**
 * Trees are torn down as soon as a case finishes.
 *
 * Several cases render twice, so without this the suite accumulates mounted screens — each holding a
 * live repository that keeps reading and writing the shared storage mock. Their writes then arrive
 * during a later case, after its clear-and-seed, and it fails with an empty screen for reasons that
 * have nothing to do with what it was testing.
 */
afterEach(async () => {
  await cleanup();
});

/**
 * Lets queued repository work finish before the next case clears storage.
 *
 * The mock sleeps 280 ms per operation on purpose, and mutations are serialised — so a case that
 * fires several presses leaves writes in flight. Without this drain they land *after* the next
 * case's clear-and-seed and overwrite it, which shows up as a screen stuck on "Preparing your
 * counter" several tests later. Draining is cheaper and clearer than making every case await every
 * press.
 */
async function renderTasbih(): Promise<typeof screen> {
  await render(
    <FaithRepositoryProvider repositories={createMockFaithRepositories()}>
      <TasbihScreen />
    </FaithRepositoryProvider>,
  );
  return screen;
}

async function countValue(view: typeof screen): Promise<string> {
  return String((await view.findByTestId('faith-tasbih-count-value')).props.children);
}

describe('haptics', () => {
  it('are offered on the screen, and on by default', async () => {
    const view = await renderTasbih();
    const toggle = await view.findByTestId('faith-tasbih-haptics-switch');

    // On the counter rather than buried in preferences, so it can be turned off in the moment it
    // becomes unwelcome.
    expect(toggle.props.value).toBe(true);
  });

  it('can be turned off, and stay off', async () => {
    const view = await renderTasbih();
    fireEvent(await view.findByTestId('faith-tasbih-haptics-switch'), 'valueChange', false);

    await waitFor(async () =>
      expect((await view.findByTestId('faith-tasbih-haptics-switch')).props.value).toBe(false),
    );

    const remounted = await renderTasbih();
    await waitFor(async () =>
      expect((await remounted.findByTestId('faith-tasbih-haptics-switch')).props.value).toBe(false),
    );
  });

  it('counting still works with them off', async () => {
    const view = await renderTasbih();
    fireEvent(await view.findByTestId('faith-tasbih-haptics-switch'), 'valueChange', false);
    fireEvent.press(await view.findByTestId('faith-tasbih-count'));

    await waitFor(async () => expect(await countValue(view)).toBe('1'));
  });
});

describe('the counter presents no religious content', () => {
  /*
    This replaced a case asserting that Arabic, a transliteration and a translation rendered as three
    distinct nodes. They no longer render at all: the five built-in entries were removed for want of
    verified Arabic, verified translation, recorded provenance and a compatible licence. The
    assertion is now the absence, which is the property that has to hold.
  */
  it('renders the counter’s own label and no scripture node', async () => {
    const view = await renderTasbih();

    // The counter is identified by its own row; there is no scripture node anywhere on the screen.
    expect(await view.findByTestId('faith-tasbih-counter-row')).toBeTruthy();
    expect(view.queryByTestId('faith-tasbih-arabic')).toBeNull();
  });

  it('shows the neutral default rather than a phrase NoorLife supplied', async () => {
    const view = await renderTasbih();
    /*
      Read from the row's spoken label rather than a visible value slot: the approved design shows
      the counter's *kind* there ("Personal"/"Default"), and the property this case exists for is
      that the counter is *named* neutrally — no phrase NoorLife supplied as religious content.
    */
    const row = await view.findByTestId('faith-tasbih-counter-row');
    expect(String(row.props.accessibilityLabel)).toContain('My counter');
  });
});

/**
 * The pure cases, deliberately last.
 *
 * ── An ordering note that is not superstition ───────────────────────────────
 * A test that renders nothing leaves this project's module-level `screen` binding pointing at the
 * previous, now-unmounted tree — so the *next* test's queries find nothing however correct its own
 * setup is. It cost an hour to see, because the failure appears in an unrelated test several lines
 * further down and looks like a broken screen.
 *
 * Keeping every non-rendering case below every rendering one makes the hazard structural rather than
 * something each new test has to remember. A new pure case goes here.
 */
/**
 * Concurrency, asserted against the repository rather than through the screen.
 *
 * The property under test is that rapid presses all land, and driving that through a React tree
 * leaves writes in flight when the case ends — which then arrive during the *next* case and
 * overwrite its setup. The repository is where the fix lives, it is where the race actually was, and
 * calling it directly makes the assertion exact instead of approximately timed.
 */
describe('rapid input is not dropped', () => {
  it('applies every adjustment, even when they arrive faster than the writes', async () => {
    const repository = createMockFaithRepositories().tasbih;
    await repository.startSession('subhanallah');

    // Fired together, deliberately unawaited between — this is what a thumb on a stepper does.
    const results = await Promise.all([
      repository.adjustTarget(-10),
      repository.adjustTarget(-10),
      repository.adjustTarget(-10),
    ]);

    for (const result of results) {
      expect(result.kind).toBe('ok');
    }
    // 33 − 30. Without the serial queue all three read the same stored session and the answer is 23.
    const session = await repository.getSession();
    expect((session as { data: { target: number } }).data.target).toBe(3);
  });

  it('counts every tap, which is the case that actually matters', async () => {
    const repository = createMockFaithRepositories().tasbih;
    await repository.startSession('subhanallah');

    // Ten taps as fast as they can be issued. A dropped one miscounts an act of worship.
    await Promise.all(Array.from({ length: 10 }, () => repository.increment()));

    const session = await repository.getSession();
    expect((session as { data: { count: number } }).data.count).toBe(10);
  });
});

describe('the target bounds', () => {
  it('has an upper bound, and a floor of one', () => {
    expect(MAX_TASBIH_TARGET).toBeGreaterThan(100);
    expect(MIN_TASBIH_TARGET).toBe(1);
  });
});
