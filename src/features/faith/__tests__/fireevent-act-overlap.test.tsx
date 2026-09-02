import AsyncStorage from '@react-native-async-storage/async-storage';
import { cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';

import { ModuleProvider } from '@features/modules/module-context';
import { seedPrayerLocation } from '@/test-support/faith-location-fixtures';
import { alertSettingsFixture } from '@/test-support/prayer-alert-fixtures';

import { PrayerAlertSheet } from '../components/prayer-alert-sheet';

/**
 * Two events in one test must not kill the renderer — issue #155.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * `fireEvent` is **async** in React Native Testing Library 14. Firing two events in one test without
 * awaiting them overlaps React's `act()` scopes, and the damage is not where it happens: the test
 * doing it still passes, and every *later* `render` in the same file returns an empty tree, so every
 * later query fails with "Unable to find an element".
 *
 * That is what made six faith suites pass only in their declared order. In
 * `prayer-alert-sheet.test.tsx` the offending test was declared last, so nothing followed it to be
 * broken — until `--randomize` moved it, at which point 26 of that file's 29 cases failed. The tell
 * is the timing: the poisoned cases fail in 1–3 ms, because nothing was ever mounted to query.
 *
 * A source-shape guard also exists (`no-restricted-syntax` in `eslint.config.js`), but this one is
 * behavioural: it exercises the actual race, so it fails if the awaits are dropped even where a lint
 * rule is silenced or a new helper hides the call.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const FAJR = alertSettingsFixture({ on: ['fajr'], preReminderMinutes: 10 }).find(
  (entry) => entry.time === 'fajr',
)!;

const NOTIFY = 'faith-prayer-alert-sheet-fajr-notify';

async function renderSheet() {
  const close = jest.fn();
  await render(
    <ModuleProvider moduleId="faith">
      <PrayerAlertSheet
        time="fajr"
        label="Fajr"
        settings={FAJR}
        masterEnabled
        permission="granted"
        exactAlarms="unknown"
        onSetNotify={jest.fn()}
        onSetRepeatDays={jest.fn()}
        onSetPreReminder={jest.fn()}
        onSetSound={jest.fn()}
        onOpenSystemSettings={jest.fn()}
        onClose={close}
      />
    </ModuleProvider>,
  );
  return close;
}

beforeEach(async () => {
  await AsyncStorage.clear();
  await seedPrayerLocation();
});

it('survives two events in one test and renders again', async () => {
  const close = await renderSheet();

  /*
    Two events, both awaited. Un-awaited, these are the exact pair that emitted
    "You seem to have overlapping act() calls" twice and left the renderer dead.
  */
  await fireEvent.press(screen.getByTestId('faith-prayer-alert-sheet-fajr-close'));
  await fireEvent.press(screen.getByTestId('faith-prayer-alert-sheet-fajr-scrim'));
  expect(close).toHaveBeenCalledTimes(2);

  /*
    The assertion that matters, and it is deliberately in *this* test rather than a later one: the
    corruption is file-scoped, so a following test would only catch it in some orders. Rendering
    again here catches it in every order.
  */
  await cleanup();
  await renderSheet();

  const tree = screen.toJSON();
  expect(`tree rendered: ${tree !== null}`).toBe('tree rendered: true');
  expect(screen.queryAllByTestId(NOTIFY)).toHaveLength(1);
});
