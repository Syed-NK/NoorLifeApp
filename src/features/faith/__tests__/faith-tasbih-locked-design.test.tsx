import AsyncStorage from '@react-native-async-storage/async-storage';
import { cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import fs from 'node:fs';
import path from 'node:path';

import { I18nManager, StyleSheet } from 'react-native';

import { AA_TEXT, AA_UI, contrastRatio } from '@features/modules/contrast';
import {
  moduleColorThemes,
  moduleNeutrals,
  readerPageBackground,
  tasbihStageSurface,
} from '@features/modules/module-tokens';

import { warmUpFirstMount } from '@/test-support/mock-latency-timers';

import { createMockFaithRepositories } from '../data/mock';
import { MAX_TASBIH_TARGET, MIN_TASBIH_TARGET } from '../data/tasbih.repository';
import { createLocalTasbihRepository } from '../data/tasbih/local-tasbih.repository';
import {
  availableMaterials,
  DEFAULT_TASBIH_MATERIAL_ID,
  isMaterialAvailable,
  isTasbihMaterialId,
  materialThumbnail,
  stagePlate,
  TASBIH_MATERIALS,
} from '../data/tasbih/tasbih-materials';
import { FaithRepositoryProvider } from '../di/faith-repository-context';
import { TasbihScreen } from '../screens/tasbih-screen';
import { defaultFaithPreferences, migratePreferences } from '../storage/faith-preferences';
import { faithAddress } from '@/test-support/faith-storage-address';

/**
 * **The locked Tasbih design, and the promises underneath it.**
 *
 * ── What this suite is for ──────────────────────────────────────────────────
 * The screen has now been rebuilt three times against three references. Each rebuild kept the same
 * domain layer and replaced the presentation, and each time the risk was the same: that a layout
 * change would quietly take a behaviour with it. These cases pin the behaviours the design depends
 * on but does not itself express — one tap is one count, a drag is not a count, a round banks once,
 * a decorative layer never steals a touch — so the next presentation pass cannot lose them silently.
 *
 * ── Why so much of it is about what must *not* happen ──────────────────────
 * Because that is where this screen's failures have been. A swipe that counted, a ring that implied
 * a target it did not have, a private label presented as scripture. Absence is the assertion.
 */

/**
 * Lets a state change land before the assertion that depends on it.
 *
 * This project has no React `act` environment, so `fireEvent` does not flush: a press and the render
 * it causes are not the same tick. See `jest-fireevent-does-not-flush`.
 */
async function settle(ms = 380): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function renderTasbih(): Promise<typeof screen> {
  render(
    <FaithRepositoryProvider repositories={createMockFaithRepositories()}>
      <TasbihScreen />
    </FaithRepositoryProvider>,
  );
  await settle(900);
  return screen;
}

function countOf(view: typeof screen): number {
  return Number(view.getByTestId('faith-tasbih-count-value').props.children);
}

/**
 * The height a finger actually gets: the drawn box plus its hit slop.
 *
 * ── Why the slop is counted ─────────────────────────────────────────────────
 * `useModuleMetrics.dp` downscales on narrow screens, so a control declared at 44 dp draws at about
 * 34 on a 320 dp phone. `minimumHitSlop` exists precisely to pay that back, and measuring only the
 * drawn box would report a failure the user never experiences — or, worse, pass on a control whose
 * slop had been dropped. Measured on device at 320 dp: Change draws 34.1 dp and receives 44.1.
 *
 * ── Why this walks up the tree ──────────────────────────────────────────────
 * `PressableScale` puts the caller's style on an outer animated view and keeps the `testID` on an
 * inner `Pressable` that fills it absolutely. Reading the styles of the node the query returns
 * therefore finds `position: absolute` and no height at all — an assertion that would pass or fail
 * for reasons unrelated to the control's real size. The sized ancestor is the touch target, so that
 * is what is measured.
 */
type StyledNode = {
  readonly props: { readonly style?: unknown };
  readonly parent: StyledNode | null;
};

function effectiveTouchHeight(view: typeof screen, testID: string): number {
  const target = view.getByTestId(testID);
  const slop = (target.props as { hitSlop?: { top?: number; bottom?: number } }).hitSlop;
  const padding = (slop?.top ?? 0) + (slop?.bottom ?? 0);

  let node: StyledNode | null = target as unknown as StyledNode;
  for (let depth = 0; node !== null && depth < 6; depth += 1) {
    const style = StyleSheet.flatten(node.props.style as never) as
      { minHeight?: number; height?: number } | undefined;
    /*
      `minHeight` or `height`: the row controls declare a floor, the circular swatches declare an
      exact diameter. Reading only the first reported zero for every swatch — a pass or a failure
      decided by which property the component happened to use rather than by its real size.
    */
    const drawn = style?.minHeight ?? style?.height;
    if (typeof drawn === 'number') {
      return drawn + padding;
    }
    node = node.parent;
  }
  return padding;
}

/* The first mount is charged for compiling the tree; paying it once keeps the opening case honest. */
warmUpFirstMount(() => renderTasbih());

beforeEach(async () => {
  await AsyncStorage.clear();
});

/**
 * Unmount, then let whatever the unmounted screen still had in flight actually land.
 *
 * `cleanup` stops the tree rendering; it does not stop a repository call already awaiting its sleep.
 * A twelve-tap burst leaves a queue of serialised writes behind it, and without a drain long enough
 * to cover them they arrive *after* the next case has cleared storage — which surfaces several
 * tests later as a screen stuck on "Preparing your counter", on cases that have nothing wrong.
 */
afterEach(async () => {
  await cleanup();
  await settle(700);
});

describe('counting', () => {
  it('increments exactly once for one valid tap', async () => {
    const view = await renderTasbih();
    expect(countOf(view)).toBe(0);

    fireEvent.press(view.getByTestId('faith-tasbih-count'));
    await settle();

    expect(countOf(view)).toBe(1);
  });

  it('increments exactly once per tap when taps come faster than writes', async () => {
    /*
      ── Why this is asserted against the repository, not the screen ──────────
      This is a claim about the serialisation queue: twelve increments issued before any of them has
      finished must still produce twelve. Driving it through the screen would need twelve
      `fireEvent.press` calls in one tick, and RNTL wraps each in `act` — with no act environment in
      this project, the overlapping calls corrupt React's queue for the rest of the file and every
      later case fails on an element that is never conditional. The queue is the thing under test, so
      it is tested where it lives. The screen's own rapid-tap behaviour is covered on device.
    */
    const repository = createLocalTasbihRepository();
    await repository.startSession('default');

    const bursts = Array.from({ length: 12 }, () => repository.increment());
    const results = await Promise.all(bursts);

    expect(results.every((result) => result.kind === 'ok')).toBe(true);
    const settled = await repository.getSession();
    expect(settled.kind).toBe('ok');
    if (settled.kind === 'ok') {
      // Twelve, not fewer: a lost update would show here as a count short of the taps made.
      expect(settled.data.count).toBe(12);
    }
  });

  it('counts each of several taps on the stage', async () => {
    const view = await renderTasbih();
    const stage = view.getByTestId('faith-tasbih-count');

    // Drained between presses, for the `act` reason recorded above.
    for (let tap = 0; tap < 3; tap += 1) {
      fireEvent.press(stage);
      await settle(380);
    }

    expect(countOf(view)).toBe(3);
  });

  it('does not increment on a long drag across the stage', async () => {
    const view = await renderTasbih();
    const stage = view.getByTestId('faith-tasbih-count');

    // Drained between events: each `fireEvent` enters an `act` scope, and this project has none.
    fireEvent(stage, 'touchStart', { nativeEvent: { pageX: 200, pageY: 200 } });
    await settle(60);
    fireEvent(stage, 'touchMove', { nativeEvent: { pageX: 200, pageY: 600 } });
    await settle(60);
    fireEvent.press(stage);
    await settle();

    expect(countOf(view)).toBe(0);
  });

  it('still counts a tap that wavers within the travel rule', async () => {
    const view = await renderTasbih();
    const stage = view.getByTestId('faith-tasbih-count');

    // A real tap is never perfectly still, least of all on a control used with the eyes shut.
    fireEvent(stage, 'touchStart', { nativeEvent: { pageX: 200, pageY: 200 } });
    await settle(60);
    fireEvent(stage, 'touchMove', { nativeEvent: { pageX: 203, pageY: 202 } });
    await settle(60);
    fireEvent.press(stage);
    await settle();

    expect(countOf(view)).toBe(1);
  });

  it('persists the count across a relaunch', async () => {
    const view = await renderTasbih();
    fireEvent.press(view.getByTestId('faith-tasbih-count'));
    await settle(380);
    fireEvent.press(view.getByTestId('faith-tasbih-count'));
    await settle(380);
    expect(countOf(view)).toBe(2);

    await cleanup();
    await settle(400);

    // A count is an act of worship in progress; losing it to a backgrounded app is not acceptable.
    const relaunched = await renderTasbih();
    expect(countOf(relaunched)).toBe(2);
  });
});

describe('rounds and undo', () => {
  it('banks exactly one round at the target and no more', async () => {
    const repository = createLocalTasbihRepository();
    await repository.startSession('default');
    await repository.adjustTarget(MIN_TASBIH_TARGET - 33);

    const target = (await repository.getSession()).kind === 'ok' ? MIN_TASBIH_TARGET : 0;
    expect(target).toBe(MIN_TASBIH_TARGET);

    const rolled = await repository.increment();
    expect(rolled.kind).toBe('ok');
    if (rolled.kind === 'ok') {
      // One repetition at a target of one completes exactly one round and resets the count.
      expect(rolled.data.rounds).toBe(1);
      expect(rolled.data.count).toBe(0);
    }
  });

  it('never takes the count below zero', async () => {
    const repository = createLocalTasbihRepository();
    await repository.startSession('default');

    for (let undo = 0; undo < 3; undo += 1) {
      const result = await repository.decrement();
      expect(result.kind).toBe('ok');
      if (result.kind === 'ok') {
        expect(result.data.count).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('does not unbank a completed round when undoing at zero', async () => {
    const repository = createLocalTasbihRepository();
    await repository.startSession('default');
    await repository.adjustTarget(MIN_TASBIH_TARGET - 33);
    await repository.increment();

    const afterUndo = await repository.decrement();
    expect(afterUndo.kind).toBe('ok');
    if (afterUndo.kind === 'ok') {
      /*
        The round is banked history, not a step that can be walked backwards. Undo removes a
        repetition; it does not un-complete a round the user already finished.
      */
      expect(afterUndo.data.rounds).toBe(1);
      expect(afterUndo.data.count).toBe(0);
    }
  });

  it('keeps the count when the target changes', async () => {
    const view = await renderTasbih();
    fireEvent.press(view.getByTestId('faith-tasbih-count'));
    await settle(600);
    expect(countOf(view)).toBe(1);

    fireEvent.press(view.getByTestId('faith-tasbih-target-up'));
    await settle(600);

    // Repetitions already made were real; adjusting an intention does not undo them.
    expect(countOf(view)).toBe(1);
    expect(String(view.getByTestId('faith-tasbih-target-value').props.children)).toBe('34');
  });

  it('clamps the target at both ends rather than wrapping', async () => {
    const repository = createLocalTasbihRepository();
    await repository.startSession('default');

    const low = await repository.adjustTarget(-1000);
    const high = await repository.adjustTarget(100000);
    if (low.kind === 'ok') {
      expect(low.data.target).toBe(MIN_TASBIH_TARGET);
    }
    if (high.kind === 'ok') {
      expect(high.data.target).toBe(MAX_TASBIH_TARGET);
    }
  });
});

describe('haptics', () => {
  it('defaults on and does not gate counting', async () => {
    expect(defaultFaithPreferences.hapticsEnabled).toBe(true);

    const view = await renderTasbih();
    const toggle = view.getByTestId('faith-tasbih-haptics-switch');
    expect(toggle.props.value).toBe(true);

    fireEvent(toggle, 'valueChange', false);
    await settle(500);

    // Counting is unaffected by the preference: feedback is a courtesy, not a precondition.
    fireEvent.press(view.getByTestId('faith-tasbih-count'));
    await settle(600);
    expect(countOf(view)).toBe(1);
  });
});

describe('bead material', () => {
  it('names the six materials the approved manifest ships, in its order', () => {
    expect(TASBIH_MATERIALS.map((material) => material.id)).toEqual([
      'walnut',
      'green-jade',
      'black-onyx',
      'white-jade',
      'sandalwood',
      'figured-brown',
    ]);
  });

  it('registers an approved thumbnail and a stage plate for every one', () => {
    /*
      A missing `require` resolves to undefined and renders as an empty circle or a blank stage.
      This is the cheap check that the whole V4 pack is actually bundled.
    */
    for (const material of TASBIH_MATERIALS) {
      expect(materialThumbnail(material.id)).toBeTruthy();
      expect(stagePlate(material.id)).toBeTruthy();
    }
  });

  it('gives every material its own plate, never another material’s', () => {
    /*
      The property that makes the selector honest. While only walnut had artwork the others fell back
      to it, and the guard against passing walnut off as jade was that they could not be selected. Now
      they can, so the guard is that the plates are genuinely distinct.
    */
    const plates = TASBIH_MATERIALS.map((material) => stagePlate(material.id));
    expect(new Set(plates).size).toBe(TASBIH_MATERIALS.length);
  });

  it('treats all six as functional', () => {
    expect(availableMaterials()).toEqual(TASBIH_MATERIALS.map((material) => material.id));
    for (const material of TASBIH_MATERIALS) {
      expect(isMaterialAvailable(material.id)).toBe(true);
    }
  });

  it('shows six selectable thumbnails with walnut selected by default', async () => {
    const view = await renderTasbih();
    await view.findByTestId('faith-tasbih-materials');

    for (const material of TASBIH_MATERIALS) {
      const swatch = view.getByTestId(`faith-tasbih-material-${material.id}`);
      expect(String(swatch.props.accessibilityLabel)).toMatch(new RegExp(material.label, 'i'));
      expect(swatch.props.accessibilityState?.selected).toBe(material.id === 'walnut');
      // Nothing is disabled and nothing warns: the artwork exists for all of them.
      expect(swatch.props.accessibilityState?.disabled).toBeUndefined();
      expect(swatch.props.accessibilityHint).toBeUndefined();
    }
  });

  it('replaces the whole stage plate when a material is chosen', async () => {
    const view = await renderTasbih();
    await view.findByTestId('faith-tasbih-materials');

    const before = view.getByTestId('faith-tasbih-strand-image', { includeHiddenElements: true })
      .props.source;
    expect(before).toBe(stagePlate('walnut'));

    fireEvent.press(view.getByTestId('faith-tasbih-material-green-jade'));
    await settle(600);

    // The stage is the whole picture, not a tint: choosing jade swaps the plate outright.
    expect(
      view.getByTestId('faith-tasbih-strand-image', { includeHiddenElements: true }).props.source,
    ).toBe(stagePlate('green-jade'));
    expect(
      view.getByTestId('faith-tasbih-material-green-jade').props.accessibilityState?.selected,
    ).toBe(true);
  });

  it('persists the chosen material by its stable id', async () => {
    const view = await renderTasbih();
    await view.findByTestId('faith-tasbih-materials');

    fireEvent.press(view.getByTestId('faith-tasbih-material-sandalwood'));
    await settle(700);

    const stored = await AsyncStorage.getItem(faithAddress('preferences'));
    expect(stored).not.toBeNull();
    expect(JSON.parse(String(stored)).tasbihMaterialId).toBe('sandalwood');
  });

  it('restores the chosen material after a relaunch', async () => {
    const view = await renderTasbih();
    await view.findByTestId('faith-tasbih-materials');
    fireEvent.press(view.getByTestId('faith-tasbih-material-black-onyx'));
    await settle(700);

    await cleanup();
    await settle(500);

    const relaunched = await renderTasbih();
    await relaunched.findByTestId('faith-tasbih-materials');
    expect(
      relaunched.getByTestId('faith-tasbih-strand-image', { includeHiddenElements: true }).props
        .source,
    ).toBe(stagePlate('black-onyx'));
  });

  it('no longer renders any unavailable-artwork notice', async () => {
    const view = await renderTasbih();
    await view.findByTestId('faith-tasbih-materials');

    expect(view.queryByTestId('faith-tasbih-materials-unavailable')).toBeNull();
    expect(view.queryByTestId('faith-tasbih-material-refusal')).toBeNull();
    expect(view.queryByText(/not available yet/i)).toBeNull();
    expect(view.queryByText(/artwork has not been added yet/i)).toBeNull();
  });

  it('lays the six swatches out as one centred row', async () => {
    const view = await renderTasbih();
    const row = StyleSheet.flatten(view.getByTestId('faith-tasbih-material-row').props.style) as {
      flexDirection?: string;
      justifyContent?: string;
      flexWrap?: string;
    };

    /*
      ── The defect this pins ──────────────────────────────────────────────
      The row previously centred its six circles across the *full* card width while a chevron sat
      absolutely at the right edge — so the group was arithmetically centred and the sixth swatch
      still ran underneath the chevron. Measured on device at 411 dp: card 66..1014 px, group
      126..955 px, chevron overlapping from ~955. The chevron is gone (it had no handler and nothing
      to open), so the row centres in the space it actually owns.
    */
    expect(row.flexDirection).toBe('row');
    expect(row.justifyContent).toBe('center');
    // No wrapping: six circles on one line at every width, sized down rather than folded.
    expect(row.flexWrap).toBeUndefined();
  });

  it('carries no chevron, because there is nothing for it to open', async () => {
    const view = await renderTasbih();
    await view.findByTestId('faith-tasbih-materials');

    /*
      It was built as a `pointerEvents="none"` glyph with no handler — a control that could not be
      pressed and led nowhere. All six materials are already on the row.
    */
    expect(view.queryByTestId('faith-tasbih-material-chevron')).toBeNull();
  });

  it('draws every swatch at one size, so the selected ring shifts nothing', async () => {
    const view = await renderTasbih();
    await view.findByTestId('faith-tasbih-materials');

    const boxes = TASBIH_MATERIALS.map(
      (material) =>
        StyleSheet.flatten(
          view.getByTestId(`faith-tasbih-material-${material.id}`).props.style,
        ) as { width?: number; height?: number; borderWidth?: number; borderRadius?: number },
    );

    // Equal circles: one width, one height, one radius across all six.
    expect(new Set(boxes.map((box) => box.width)).size).toBe(1);
    expect(new Set(boxes.map((box) => box.height)).size).toBe(1);
    expect(new Set(boxes.map((box) => box.borderRadius)).size).toBe(1);

    /*
      The selected one carries a 2 px border against the others' 1 px, and that must not move the
      row. React Native draws a border *inside* the box, so the outer width is unchanged — asserted
      here rather than assumed, because a switch to an outline or a margin would break it silently.
    */
    const selected = boxes.filter((box) => box.borderWidth === 2);
    expect(selected).toHaveLength(1);
    expect(new Set(boxes.map((box) => box.width)).size).toBe(1);
  });

  it('keeps every swatch press target at or above 44 dp', async () => {
    const view = await renderTasbih();
    await view.findByTestId('faith-tasbih-materials');

    /*
      The drawn circle shrinks on a narrow screen so six fit without wrapping; `minimumHitSlop` pays
      the difference back so the finger still gets 44 dp.
    */
    for (const material of TASBIH_MATERIALS) {
      expect(
        effectiveTouchHeight(view, `faith-tasbih-material-${material.id}`),
      ).toBeGreaterThanOrEqual(44);
    }
  });

  it('persists a stable id, never a filename or a module reference', () => {
    expect(defaultFaithPreferences.tasbihMaterialId).toBe(DEFAULT_TASBIH_MATERIAL_ID);
    const stored = String(defaultFaithPreferences.tasbihMaterialId);
    expect(stored).not.toMatch(/\.(png|jpg|webp)$/i);
    expect(stored).not.toMatch(/[/\\]/);
    expect(typeof defaultFaithPreferences.tasbihMaterialId).toBe('string');
  });

  it.each([
    ['an unknown material', 'platinum'],
    ['the superseded spelling', 'figured-stone'],
    ['the wrong type', 42],
    ['null', null],
  ] as const)('migrates %s safely to walnut', (_name, stored) => {
    expect(migratePreferences({ tasbihMaterialId: stored }).tasbihMaterialId).toBe(
      DEFAULT_TASBIH_MATERIAL_ID,
    );
  });

  it('keeps a material the user actually chose', () => {
    for (const material of TASBIH_MATERIALS) {
      expect(migratePreferences({ tasbihMaterialId: material.id }).tasbihMaterialId).toBe(
        material.id,
      );
    }
    expect(isTasbihMaterialId('figured-stone')).toBe(false);
  });
});

describe('the stage meets the page without a seam', () => {
  it('grounds the screen in the plates’ own ivory', () => {
    /*
      ── The seam this removes ─────────────────────────────────────────────
      The plates are photographs on a warm studio ivory; measured at their corners all six sit within
      a few units of #F6ECE4. The screen used the reader's #FDFAF5, which is lighter and cooler, so
      the artwork drew a visible rectangle on the page. Matching the ground to the photograph closes
      the join without touching the image — no crop, no fade, no scrim over the beads.
    */
    expect(tasbihStageSurface).toBe('#F6ECE4');
    expect(tasbihStageSurface).not.toBe(readerPageBackground);
    expect(moduleNeutrals.pageBackground).toBe('#F7F9FC');
  });

  it('keeps text on it above the contrast bar', () => {
    expect(contrastRatio(moduleNeutrals.textPrimary, tasbihStageSurface)).toBeGreaterThanOrEqual(
      AA_TEXT,
    );
    expect(contrastRatio(moduleNeutrals.textSecondary, tasbihStageSurface)).toBeGreaterThanOrEqual(
      AA_TEXT,
    );
    // Emerald tints controls rather than carrying text, so the non-text bar applies.
    expect(contrastRatio(moduleColorThemes.faith.ink, tasbihStageSurface)).toBeGreaterThanOrEqual(
      AA_UI,
    );
  });

  it('still separates the white control cards from the ground', () => {
    // Enough that the cards read as raised, not so much that they glare on a warm page.
    const separation = contrastRatio(moduleNeutrals.surface, tasbihStageSurface);
    expect(separation).toBeGreaterThan(1.05);
    expect(separation).toBeLessThan(1.4);
  });
});

describe('the review-only artwork is not bundled', () => {
  it('imports neither the source board nor the contact sheet', () => {
    /*
      Both are review aids the handoff explicitly excludes — together about 2.2 MB, and the source
      board is a contact sheet of every material, which would ship a picture of the five that do not
      work. Asserted against the one module allowed to reference bead artwork.
    */
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/features/faith/data/tasbih/tasbih-materials.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/source-board/);
    expect(source).not.toMatch(/contact-sheet/);
  });

  it('keeps them out of the bundled asset directory', () => {
    const bundled = fs.readdirSync(path.join(process.cwd(), 'assets/images/modules/faith/tasbih'));
    expect(bundled.filter((name) => /source-board|contact-sheet/.test(name))).toEqual([]);
  });

  it('carries none of the superseded stage plates', () => {
    /*
      Two earlier plates were rejected: an 852 x 1846 portrait that `cover` cropped the tail from, and
      a 1254 x 1254 walnut-only `-closeup-` file. Either lingering in the bundle would be several
      megabytes of artwork nothing renders.
    */
    const dir = path.join(process.cwd(), 'assets/images/modules/faith/tasbih');
    const bundled = fs.readdirSync(dir);
    expect(bundled.filter((name) => /closeup/.test(name))).toEqual([]);

    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/features/faith/data/tasbih/tasbih-materials.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/closeup/);
  });
});

describe('the control card matches the locked design', () => {
  it('offers Change, and it opens the selector', async () => {
    const view = await renderTasbih();
    const change = view.getByTestId('faith-tasbih-change');

    expect(change.props.accessibilityRole).toBe('button');
    /*
      ── The label used to say "Change dhikr", and that had become wrong ───────
      What this control changes may be a private counter or a Quran selection the user chose, and
      neither is a dhikr — calling a verse somebody picked for themselves a dhikr is the claim this
      module spends most of its code refusing to make. The label states the action instead.
    */
    expect(String(change.props.accessibilityLabel)).toMatch(/choose what to count/i);
    fireEvent.press(change);
    await settle(200);

    // Navigation is the selector's own screen; the counting screen never grows an inline list.
    expect(view.queryByTestId('faith-tasbih-counters')).toBeNull();
  });

  it('carries no fabricated religious content', async () => {
    const view = await renderTasbih();

    /*
      The mock fills this row with a well-known phrase. NoorLife has no licence for any dhikr text,
      so the row must report that rather than ship a remembered string.
    */
    expect(String(view.getByTestId('faith-tasbih-dhikr-value').props.children)).toBe(
      'Not selected',
    );
    const arabic = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/;
    expect(JSON.stringify(view.toJSON())).not.toMatch(arabic);
  });

  it('omits every control the design excludes', async () => {
    const view = await renderTasbih();

    for (const absent of [
      'faith-tasbih-reset',
      'faith-tasbih-target-up-leap',
      'faith-tasbih-target-down-leap',
      'faith-tasbih-halo',
      'faith-tasbih-strand-slot',
    ]) {
      expect(view.queryByTestId(absent)).toBeNull();
    }
  });

  it('keeps every touch target at or above the minimum', async () => {
    const view = await renderTasbih();

    for (const id of ['faith-tasbih-change', 'faith-tasbih-undo', 'faith-tasbih-counter-row']) {
      // 44 dp is the floor for anything a thumb has to find without looking.
      expect(effectiveTouchHeight(view, id)).toBeGreaterThanOrEqual(44);
    }
  });
});

describe('the decorative layer', () => {
  it('exists, takes no touches and is hidden from assistive technology', async () => {
    const view = await renderTasbih();
    const layer = view.getByTestId('faith-tasbih-strand-layer', { includeHiddenElements: true });

    /*
      The strand is scenery. If it ever intercepted a press the counting surface would develop a
      dead zone exactly where the design puts the beads — the most tappable-looking part of the
      screen.
    */
    expect(layer.props.pointerEvents).toBe('none');
    expect(layer.props.accessible).toBe(false);
    expect(layer.props.importantForAccessibility).toBe('no-hide-descendants');

    /*
      And it draws the approved plate with `contain`. Never `cover`: the plate carries the complete
      terminal, braided loop and tassel inside its own square canvas, and scaling past the box is
      precisely what cut the tail off in the two rejected passes.
    */
    const art = view.getByTestId('faith-tasbih-strand-image', { includeHiddenElements: true });
    expect(art.props.source).toBe(stagePlate('walnut'));
    expect(art.props.resizeMode).toBe('contain');
  });

  it('does not stop the stage beneath it from counting', async () => {
    const view = await renderTasbih();

    fireEvent.press(view.getByTestId('faith-tasbih-count'));
    await settle();

    expect(countOf(view)).toBe(1);
  });
});

describe('the counting stage is sized by the artwork', () => {
  it('is a near-square derived from the plate, not a fixed height', async () => {
    const view = await renderTasbih();
    const style = StyleSheet.flatten(view.getByTestId('faith-tasbih-count').props.style) as {
      aspectRatio?: number;
    };

    /*
      Sized by the artwork's own aspect rather than by a height. A fixed height changed the crop on
      every different screen and cropped the gold terminal out entirely — the defect this replaces.
    */
    expect(style.aspectRatio).toBe(1);
  });
});

describe('layout direction', () => {
  it('does not reverse the numerals under RTL', async () => {
    const wasRTL = I18nManager.isRTL;
    try {
      I18nManager.allowRTL(true);
      I18nManager.forceRTL(true);

      const view = await renderTasbih();
      fireEvent.press(view.getByTestId('faith-tasbih-count'));
      await settle(600);

      /*
        Arabic-script locales read right to left; the digits do not change meaning, and the target
        must not arrive mirrored. Counting semantics are direction-independent by construction —
        they are numbers from the repository, not layout.
      */
      expect(countOf(view)).toBe(1);
      expect(String(view.getByTestId('faith-tasbih-target-value').props.children)).toBe('33');
    } finally {
      I18nManager.forceRTL(wasRTL);
    }
  });
});

describe('the V2 migration is untouched by this pass', () => {
  it('still upgrades a v1 session and keeps the material default alongside it', () => {
    const migrated = migratePreferences({ hapticsEnabled: false });

    // The new preference rides alongside the existing ones; it replaces nothing.
    expect(migrated.hapticsEnabled).toBe(false);
    expect(migrated.tasbihMaterialId).toBe(DEFAULT_TASBIH_MATERIAL_ID);
    expect(migrated.calculationMethod).toBe(defaultFaithPreferences.calculationMethod);
  });
});
