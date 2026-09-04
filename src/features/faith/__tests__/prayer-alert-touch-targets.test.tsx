import { render, screen } from '@testing-library/react-native';
import React from 'react';

import { ModuleProvider } from '@features/modules/module-context';
import { touchTarget } from '@ds/tokens';
import { alertSettingsFixture } from '@/test-support/prayer-alert-fixtures';

import { PrayerAlertSheet } from '../components/prayer-alert-sheet';
import { PRE_REMINDER_CHOICES, WEEKDAYS } from '../data/notifications/prayer-alert-preferences';

/**
 * Every control in the per-prayer sheet has to be big enough to hit.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Measured on a device, not assumed ──────────────────────────────────────
 * `uiautomator dump` on the emulator reported the seven day circles at **100 px** and the option
 * pills at **79 px** on a 2.625-density screen — 38.1 dp and 30.1 dp. Both are under the 44 dp
 * minimum §8 requires, and nothing in the component tree said so: an undersized target renders
 * perfectly and simply misses. No existing test could have caught it, because none of them knew what
 * the numbers were until a device reported them.
 *
 * ── Why the two are fixed differently ──────────────────────────────────────
 * The circles keep their drawn diameter and gain hit slop: seven of them have to fit one row at
 * 360 dp, so the visual size is fixed by the layout — exactly the case `minimumHitSlop` documents.
 * Their 6 dp gap means two neighbours' expanded areas meet without overlapping.
 *
 * The pills grow instead. They wrap onto a second row with a 6 dp gap, so expanding a 30 dp control
 * to 44 with slop would push 7 dp past each edge and the two rows' touch areas would overlap by
 * 8 dp — a tap in the gap could resolve to either row. Sizing the control removes the ambiguity, and
 * is what `minimumHitSlop`'s own note prefers where the design allows it.
 *
 * ── Why this is its own file ───────────────────────────────────────────────
 * The sheet's main suite renders the component about thirty times, and appending to it put these
 * cases behind that accumulation in a suite with no act environment, where the queries stopped
 * finding freshly rendered nodes. Splitting is the same separation the rest of the module uses.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const FAJR = alertSettingsFixture({ on: ['fajr'], preReminderMinutes: 10 }).find(
  (entry) => entry.time === 'fajr',
)!;

const id = (suffix: string) => `faith-prayer-alert-sheet-fajr${suffix}`;

async function renderSheet() {
  await render(
    <ModuleProvider moduleId="faith">
      <PrayerAlertSheet
        time="fajr"
        label="Fajr"
        settings={FAJR}
        masterEnabled
        permission="granted"
        exactAlarms="unknown"
        onSetNotify={() => {}}
        onSetRepeatDays={() => {}}
        onSetPreReminder={() => {}}
        onSetSound={() => {}}
        onSetMode={() => {}}
        onOpenSystemSettings={() => {}}
        onClose={() => {}}
      />
    </ModuleProvider>,
  );
}

/** The flattened style of one node, so a value can be read whatever shape the array is in. */
function flatStyle(testID: string): Record<string, unknown> {
  const style = screen.getByTestId(testID).props.style;
  return (Array.isArray(style) ? style : [style])
    .filter(
      (entry: unknown): entry is Record<string, unknown> =>
        typeof entry === 'object' && entry !== null,
    )
    .reduce<Record<string, unknown>>((all, entry) => ({ ...all, ...entry }), {});
}

describe('the seven day circles reach the minimum through hit slop', () => {
  it('gives every day an expanded touch area on all four edges', async () => {
    await renderSheet();

    expect(WEEKDAYS).toHaveLength(7);
    for (const day of WEEKDAYS) {
      const slop = screen.getByTestId(id(`-day-${day.index}`)).props.hitSlop;
      expect(slop).toBeDefined();
      for (const edge of ['top', 'bottom', 'left', 'right'] as const) {
        expect(slop[edge]).toBeGreaterThan(0);
      }
    }
  });

  it('keeps the drawn diameter, because seven have to fit one row', async () => {
    await renderSheet();

    const drawn = flatStyle(id('-day-0'));
    expect(typeof drawn.width).toBe('number');
    // Under the minimum on purpose — that is why the slop above exists.
    expect(drawn.width as number).toBeLessThan(touchTarget.minimum);
    expect(drawn.width).toBe(drawn.height);
  });
});

describe('the option pills reach the minimum by being that size', () => {
  const PILLS = [
    ...PRE_REMINDER_CHOICES.map((minutes) => `-pre-${minutes}`),
    '-sound-system-default',
    '-sound-silent',
  ];

  it.each(PILLS)('%s is at least the minimum tall', async (suffix) => {
    await renderSheet();

    const style = flatStyle(id(suffix));
    expect(typeof style.minHeight).toBe('number');
    /*
      Exactly the token, unscaled. `dp()` scales by screen width, so a floor wrapped in it measured
      43 dp on the 384 dp physical phone — and a minimum that shrinks with the screen is not a
      minimum. Asserted as equality rather than `>=` so re-wrapping it fails here.
    */
    expect(style.minHeight).toBe(touchTarget.minimum);
  });

  it.each(PILLS)('%s is sized rather than slopped', async (suffix) => {
    /*
      Asserted as an absence, because slop here would be the wrong fix: two wrapped rows 6 dp apart
      would have overlapping touch areas, and a tap in the gap would be ambiguous.
    */
    await renderSheet();
    expect(screen.getByTestId(id(suffix)).props.hitSlop).toBeUndefined();
  });

  it('centres its label so growing the pill does not misalign the text', async () => {
    await renderSheet();
    expect(flatStyle(id('-pre-10')).justifyContent).toBe('center');
  });
});
