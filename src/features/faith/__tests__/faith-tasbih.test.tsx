import AsyncStorage from '@react-native-async-storage/async-storage';
import { cleanup, render, fireEvent, screen, waitFor } from '@testing-library/react-native';
import React from 'react';

import { warmUpFirstMount } from '@/test-support/mock-latency-timers';

import { createMockFaithRepositories } from '../data/mock';
import { MIN_TASBIH_TARGET } from '../data/tasbih.repository';
import { FaithRepositoryProvider } from '../di/faith-repository-context';
import { TasbihScreen } from '../screens/tasbih-screen';
import { faithAddress } from '@/test-support/faith-storage-address';

/**
 * The tasbih counter.
 *
 * ── The interaction defect this replaces ────────────────────────────────────
 * Counting used to require hitting a 190 dp circle in the middle of the screen — a precision task
 * repeated a hundred times, usually one-handed and often with the user's eyes shut. Every miss is a
 * bead lost. The whole card counts now, and the cases below check both halves of that: the card
 * counts, and the controls that are *not* counting do not.
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

describe('counting', () => {
  it('counts from a tap anywhere on the card, not just a circle', async () => {
    const view = await renderTasbih();
    expect(await countValue(view)).toBe('0');

    // The card itself is the control. There is no inner button to miss.
    await fireEvent.press(await view.findByTestId('faith-tasbih-count'));

    await waitFor(async () => expect(await countValue(view)).toBe('1'));
  });

  it('announces the whole card as the button', async () => {
    const view = await renderTasbih();
    const card = await view.findByTestId('faith-tasbih-count');

    expect(card.props.accessibilityRole).toBe('button');
    expect(String(card.props.accessibilityHint)).toMatch(/add one/i);
    /*
      The spoken label carries the counter's name, the position in the round and the rounds banked —
      everything a screen-reader user needs without exploring the bead ring, which is decorative and
      hidden from the accessibility tree on purpose.
    */
    const label = String(card.props.accessibilityLabel);
    expect(label).toMatch(/of \d+/);
    expect(label).toMatch(/My counter/);
    expect(label).toMatch(/round/i);
  });

  it('persists the count across a remount', async () => {
    const view = await renderTasbih();
    await fireEvent.press(await view.findByTestId('faith-tasbih-count'));
    await fireEvent.press(await view.findByTestId('faith-tasbih-count'));
    await waitFor(async () => expect(await countValue(view)).toBe('2'));

    // A count is an act of worship in progress; losing it to a backgrounded app is not acceptable.
    const remounted = await renderTasbih();
    await waitFor(async () => expect(await countValue(remounted)).toBe('2'));
  });

  it('undoes a mis-tap without going below zero', async () => {
    const view = await renderTasbih();
    await fireEvent.press(await view.findByTestId('faith-tasbih-undo'));
    await waitFor(async () => expect(await countValue(view)).toBe('0'));
  });
});

describe('the controls do not count', () => {
  /**
   * The specific hazard tap-anywhere creates.
   *
   * With the whole card counting, a thumb reaching for Undo passes over the counting surface. The
   * controls sit outside it for that reason, and these cases prove it rather than assuming it — a
   * layout change that moved a control inside the card would fail here.
   */
  it('undo removes a bead rather than adding one', async () => {
    const view = await renderTasbih();
    await fireEvent.press(await view.findByTestId('faith-tasbih-count'));
    await fireEvent.press(await view.findByTestId('faith-tasbih-count'));
    await waitFor(async () => expect(await countValue(view)).toBe('2'));

    await fireEvent.press(await view.findByTestId('faith-tasbih-undo'));
    await waitFor(async () => expect(await countValue(view)).toBe('1'));
  });

  it('the target stepper does not add a bead', async () => {
    const view = await renderTasbih();
    await fireEvent.press(await view.findByTestId('faith-tasbih-count'));
    await waitFor(async () => expect(await countValue(view)).toBe('1'));

    await fireEvent.press(await view.findByTestId('faith-tasbih-target-up'));
    await fireEvent.press(await view.findByTestId('faith-tasbih-target-down'));

    await waitFor(async () => expect(await countValue(view)).toBe('1'));
  });

  it('Change does not add a bead on its way to the selector', async () => {
    const view = await renderTasbih();
    await fireEvent.press(await view.findByTestId('faith-tasbih-change'));

    // It sits inside the sheet rather than on the counting surface, so a thumb reaching for it
    // cannot bank a repetition the user did not make.
    expect(await countValue(view)).toBe('0');
  });
});

describe('the round', () => {
  it('rolls over at the target and banks a round', async () => {
    // Seeded at a round of one, so the rollover is one press rather than thirty-two. Driving the
    // stepper down to it is a different property and is asserted separately below.
    await seedSession({ target: 1 });
    const view = await renderTasbih();
    await view.findByTestId('faith-tasbih-count');

    await fireEvent.press(view.getByTestId('faith-tasbih-count'));

    /*
      At the target the count returns to zero and the round is banked, as a physical strand does.

      The label is the round being *counted*, not the number banked: a fresh session reads
      "Round 1" with nothing banked, so banking the first round advances it to "Round 2". This
      asserted `/Round 1/` — the value from *before* the press — and passed only because the press
      never took effect: `fireEvent` is async in RNTL 14 and was not awaited, so the tap was
      dropped and the seeded state was what got asserted. See #155.
    */
    await waitFor(
      async () =>
        expect(String((await view.findByTestId('faith-tasbih-rounds')).props.children)).toMatch(
          /Round 2/,
        ),
      { timeout: 4000 },
    );
    expect(await countValue(view)).toBe('0');
  });

  it('keeps the count when the target changes', async () => {
    const view = await renderTasbih();
    await fireEvent.press(await view.findByTestId('faith-tasbih-count'));
    await fireEvent.press(await view.findByTestId('faith-tasbih-count'));
    await waitFor(async () => expect(await countValue(view)).toBe('2'));

    await fireEvent.press(await view.findByTestId('faith-tasbih-target-up'));

    // The taps already made were real. Discarding them because somebody adjusted their intention
    // would be the counter deciding their dhikr did not happen.
    await waitFor(async () => expect(await countValue(view)).toBe('2'));
  });
});

describe('the target', () => {
  it('starts at the dhikr’s traditional value', async () => {
    const view = await renderTasbih();
    // Subhan Allah after prayer is thirty-three.
    expect(String((await view.findByTestId('faith-tasbih-target-value')).props.children)).toBe(
      '33',
    );
  });

  it('changes one step at a time', async () => {
    const view = await renderTasbih();

    /*
      One at a time is the whole control now. The ±10 leap buttons were removed with the rejected
      pass: the approved design has minus, the current target and plus, and five circles in a row
      read as a settings form rather than as part of a counter.
    */
    await fireEvent.press(await view.findByTestId('faith-tasbih-target-up'));
    await waitFor(async () =>
      expect(String((await view.findByTestId('faith-tasbih-target-value')).props.children)).toBe(
        '34',
      ),
    );
  });

  it('persists across a remount', async () => {
    const view = await renderTasbih();
    await fireEvent.press(await view.findByTestId('faith-tasbih-target-up'));
    await waitFor(async () =>
      expect(String((await view.findByTestId('faith-tasbih-target-value')).props.children)).toBe(
        '34',
      ),
    );

    const remounted = await renderTasbih();
    await waitFor(async () =>
      expect(
        String((await remounted.findByTestId('faith-tasbih-target-value')).props.children),
      ).toBe('34'),
    );
  });

  it('cannot be taken below one', async () => {
    // Seeded one step above the floor, so the boundary is one press rather than thirty-two writes
    // left in flight at the end of the case.
    await seedSession({ target: MIN_TASBIH_TARGET + 1 });
    const view = await renderTasbih();
    await view.findByTestId('faith-tasbih-target-down');

    await fireEvent.press(view.getByTestId('faith-tasbih-target-down'));

    await waitFor(
      async () =>
        expect(String((await view.findByTestId('faith-tasbih-target-value')).props.children)).toBe(
          String(MIN_TASBIH_TARGET),
        ),
      { timeout: 4000 },
    );
    // And the control says so rather than silently doing nothing.
    expect(
      (await view.findByTestId('faith-tasbih-target-down')).props.accessibilityState,
    ).toMatchObject({ disabled: true });
  });
});
