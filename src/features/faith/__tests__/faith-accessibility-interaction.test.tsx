import AsyncStorage from '@react-native-async-storage/async-storage';
import { render, screen } from '@testing-library/react-native';
import React, { type ReactElement } from 'react';

import { seedPrayerLocation } from '@/test-support/faith-location-fixtures';
import { seedTranslationPreference } from '@/test-support/faith-preferences-fixtures';
import { installMockLatencyTimers } from '@/test-support/mock-latency-timers';

import { mockFileSystem, setRouteParams } from '../../../../jest.setup';

import type { FaithRepositories } from '../data';
import { offlineFileName, PERMITTED_RESOURCE_ID } from '../storage/faith-offline-recitation';
import { toggleBookmark } from '../storage/faith-bookmarks';
import { createMockFaithRepositories } from '../data/mock';
import { FaithRepositoryProvider } from '../di/faith-repository-context';
import { BookmarksScreen } from '../screens/bookmarks-screen';
import { CalendarScreen } from '../screens/calendar-screens';
import { DhikrSelectorScreen } from '../screens/dhikr-selector-screen';
import { PrayerLocationScreen } from '../screens/prayer-location-screen';
import { PrayerRemindersScreen } from '../screens/prayer-reminders-screen';
import { PreferencesScreen } from '../screens/preferences-screen';
import { QiblaScreen } from '../screens/qibla-screen';
import { QuranScreen } from '../screens/quran-screen';
import { ReaderScreen } from '../screens/reader-screen';
import { ReciterScreen } from '../screens/reciter-screen';
import { TasbihScreen } from '../screens/tasbih-screen';
import { TranslationScreen } from '../screens/translation-screen';

/**
 * No accessible container may swallow an interactive descendant, anywhere in Faith.
 *
 * ── The defect this exists to make unrepeatable ─────────────────────────────
 * `FaithRow` wrapped its body in `<View accessible>`. On Android that means *this subtree is one
 * node*: the platform collapses everything inside and stops exposing the children. The prayer
 * reminder rows put a `Switch` in that subtree, so the master switch and all five per-prayer
 * switches vanished from the accessibility hierarchy — `uiautomator dump` showed a `ViewGroup` with
 * `clickable=false` where an `android.widget.Switch` should have been, and neither TalkBack nor an
 * accessibility-driven tap could reach `onValueChange`.
 *
 * Nothing about the JavaScript was wrong, which is exactly why no test caught it: `fireEvent` calls
 * the prop directly and never goes near the platform's view tree. So this suite does not fire
 * events. It renders each screen and **walks the rendered tree**, applying the same rule Android
 * applies — and it is the guard that keeps a future `accessible` from silently doing it again.
 *
 * ── The three rules ─────────────────────────────────────────────────────────
 *   1. An `accessible` node may not contain an interactive descendant.
 *   2. An interactive node may not contain another interactive node — nested pressables produce two
 *      actions on one gesture, and Android exposes only the outer one.
 *   3. A node that is interactive must be reachable: it needs an accessible name.
 *
 * A screen may legitimately have an `accessible` container over *text* — that is the point of the
 * flag, and the prayer status lines rely on it. The rule is only about interactive descendants.
 */

installMockLatencyTimers(() => withRepositories(<QuranScreen key="warm-up" />));

beforeEach(async () => {
  await AsyncStorage.clear();
  await seedTranslationPreference();
  await seedPrayerLocation();
  await seedInteractiveContent();
  setRouteParams({});
});

/**
 * Content the flagged rows need in order to exist at all.
 *
 * ── Why the seeding is load-bearing, not scaffolding ────────────────────────
 * The first version of this suite passed everywhere, including on the two surfaces the audit was
 * commissioned for. Both render *empty* against cleared storage: Bookmarks has no rows without a
 * bookmark, and the Downloads panel has no rows without a download. A guard that walks an empty list
 * proves nothing, so each screen below is put into the state where its controls are drawn.
 */
async function seedInteractiveContent(): Promise<void> {
  await toggleBookmark(
    {
      kind: 'ayah',
      id: '2:255',
      label: 'Al-Baqarah 2:255',
      subtitle: 'A saved verse',
    },
    '2026-08-15T00:00:00.000Z',
  );
  /*
    Files in the **permanent** private directory, which is where downloaded recitation lives now.
    Seeding the evictable cache would seed a directory nothing reads any more: playback is sourced
    from the offline manifest's store, and the cache exists only for the one-time migration to empty.
  */
  for (let ayah = 1; ayah <= 7; ayah += 1) {
    mockFileSystem.seed(
      `file:///documents/faith-recitations-downloaded/${offlineFileName(PERMITTED_RESOURCE_ID, 1, ayah)}`,
      mockFileSystem.audioBytes(4096),
    );
  }
}

async function withRepositories(element: ReactElement, repositories?: Partial<FaithRepositories>) {
  await render(
    <FaithRepositoryProvider repositories={{ ...createMockFaithRepositories(), ...repositories }}>
      {element}
    </FaithRepositoryProvider>,
  );
  return screen;
}

type TreeNode = {
  readonly type?: unknown;
  readonly props?: Record<string, unknown>;
  readonly children?: readonly (TreeNode | string | null)[] | null;
};

/**
 * Whether a rendered node is something a user can operate.
 *
 * Handlers *and* roles, because the two arrive independently: a `Pressable` carries `onPress`, a
 * `Switch` carries `onValueChange`, and a component that only sets `accessibilityRole="button"` is
 * still announced as a control whether or not this tree exposes its handler.
 */
const INTERACTIVE_ROLES = new Set([
  'button',
  'switch',
  'link',
  'checkbox',
  'radio',
  'tab',
  'menuitem',
  'togglebutton',
]);

/**
 * The props a pressable actually carries **on the host tree**.
 *
 * ── Why `onPress` is not enough, and why that mattered ──────────────────────
 * `screen.toJSON()` returns host components, not the React elements that produced them. A
 * `Pressable` renders to a `View` whose `onPress` has already been consumed by the responder
 * system — what survives is `onClick` plus the `onResponder*` family. The first version of this
 * walker looked for `onPress` and therefore found nothing on any screen, which read as "no defects"
 * when it actually meant "no detection".
 */
const HOST_PRESS_PROPS = ['onClick', 'onStartShouldSetResponder', 'onResponderRelease'] as const;

function isInteractive(props: Record<string, unknown>): boolean {
  if (
    props.accessibilityRole !== undefined &&
    INTERACTIVE_ROLES.has(String(props.accessibilityRole))
  ) {
    return true;
  }
  if (typeof props.onPress === 'function' || typeof props.onValueChange === 'function') {
    return true;
  }
  return HOST_PRESS_PROPS.some((key) => typeof props[key] === 'function');
}

/** The accessible name a screen reader would announce, if any. */
function accessibleName(props: Record<string, unknown>): string {
  const label = props.accessibilityLabel;
  return typeof label === 'string' ? label.trim() : '';
}

function describeNode(node: TreeNode): string {
  const props = node.props ?? {};
  const id = props.testID === undefined ? '' : ` testID=${String(props.testID)}`;
  const role =
    props.accessibilityRole === undefined ? '' : ` role=${String(props.accessibilityRole)}`;
  const label = accessibleName(props) === '' ? '' : ` label="${accessibleName(props)}"`;
  return `${String(node.type ?? 'node')}${id}${role}${label}`;
}

type Finding = { readonly rule: string; readonly detail: string };

/**
 * Walks a rendered tree and reports every violation of the three rules.
 *
 * `accessible: false` is respected as an explicit opt-out — that is precisely how `FaithRow` now
 * declares a row whose control must stay reachable — and it re-opens the subtree for anything
 * nested below it.
 */
function auditTree(root: TreeNode | string | null, screenName: string): readonly Finding[] {
  const findings: Finding[] = [];

  const walk = (
    node: TreeNode | string | null,
    insideAccessible: TreeNode | null,
    insideInteractive: TreeNode | null,
  ): void => {
    if (node === null || typeof node === 'string') {
      return;
    }
    const props = node.props ?? {};
    const interactive = isInteractive(props);

    if (interactive && insideAccessible !== null) {
      findings.push({
        rule: 'accessible container swallows an interactive descendant',
        detail: `${screenName}: ${describeNode(insideAccessible)} contains ${describeNode(node)}`,
      });
    }
    if (interactive && insideInteractive !== null) {
      findings.push({
        rule: 'nested interactive nodes',
        detail: `${screenName}: ${describeNode(insideInteractive)} contains ${describeNode(node)}`,
      });
    }
    if (interactive && accessibleName(props) === '') {
      findings.push({
        rule: 'interactive node has no accessible name',
        detail: `${screenName}: ${describeNode(node)}`,
      });
    }

    /*
      `accessible={false}` is an explicit re-opening of the subtree, so it clears the enclosing
      container rather than inheriting it. Anything else inherits.
    */
    const nextAccessible =
      props.accessible === false ? null : props.accessible === true ? node : insideAccessible;
    const nextInteractive = interactive ? node : insideInteractive;

    for (const child of node.children ?? []) {
      walk(child, nextAccessible, nextInteractive);
    }
  };

  walk(root, null, null);
  return findings;
}

/**
 * The surfaces the brief names, each rendered in the state where its controls exist.
 *
 * The reader is opened at a verse so the deep-link path, the ayah rows and the docked player are all
 * present; the reciter screen carries the download controls; Tasbih carries the material swatches
 * and the Current Dhikr row.
 */
const SCREENS: readonly { readonly name: string; readonly render: () => Promise<unknown> }[] = [
  { name: 'PrayerReminders', render: () => withRepositories(<PrayerRemindersScreen />) },
  { name: 'PrayerLocation', render: () => withRepositories(<PrayerLocationScreen />) },
  { name: 'Preferences', render: () => withRepositories(<PreferencesScreen />) },
  { name: 'Bookmarks', render: () => withRepositories(<BookmarksScreen />) },
  { name: 'QuranHome', render: () => withRepositories(<QuranScreen />) },
  { name: 'Translations', render: () => withRepositories(<TranslationScreen />) },
  { name: 'Reciters', render: () => withRepositories(<ReciterScreen />) },
  { name: 'Tasbih', render: () => withRepositories(<TasbihScreen />) },
  { name: 'DhikrSelector', render: () => withRepositories(<DhikrSelectorScreen />) },
  { name: 'Qibla', render: () => withRepositories(<QiblaScreen />) },
  { name: 'Calendar', render: () => withRepositories(<CalendarScreen />) },
  {
    name: 'Reader',
    render: async () => {
      setRouteParams({ surah: '1', ayah: '2' });
      return withRepositories(<ReaderScreen />);
    },
  },
];

describe('no accessible container swallows an interactive control', () => {
  it.each(SCREENS.map((entry) => [entry.name, entry] as const))(
    '%s exposes every control it draws',
    async (_name, entry) => {
      await entry.render();
      const findings = auditTree(screen.toJSON() as TreeNode | null, entry.name);

      /*
        Reported as the full list rather than a count, so a failure names the container and the
        control it hid instead of asserting that a number changed.
      */
      expect(findings.map((finding) => `${finding.rule} — ${finding.detail}`)).toEqual([]);
    },
  );
});

describe('the rule the guard enforces', () => {
  /*
    The guard is only worth having if it fails on the shape that shipped. These two cases pin its
    behaviour directly, so a future refactor of the walker cannot quietly stop detecting anything.
  */
  it('detects an accessible container wrapping a control', () => {
    const swallowed: TreeNode = {
      type: 'View',
      props: { accessible: true, accessibilityLabel: 'Row' },
      children: [
        {
          type: 'Switch',
          props: { onValueChange: () => undefined, accessibilityLabel: 'A switch' },
          children: [],
        },
      ],
    };
    expect(auditTree(swallowed, 'fixture')).toHaveLength(1);
  });

  it('accepts the corrected shape, where the row opts out and the control stays exposed', () => {
    const corrected: TreeNode = {
      type: 'View',
      props: { accessible: false },
      children: [
        {
          type: 'View',
          props: { accessible: true, accessibilityLabel: 'Row text' },
          children: [{ type: 'Text', props: {}, children: [] }],
        },
        {
          type: 'Switch',
          props: { onValueChange: () => undefined, accessibilityLabel: 'A switch' },
          children: [],
        },
      ],
    };
    expect(auditTree(corrected, 'fixture')).toEqual([]);
  });

  it('detects a pressable nested inside another pressable', () => {
    const nested: TreeNode = {
      type: 'View',
      props: { onPress: () => undefined, accessibilityLabel: 'Outer' },
      children: [
        {
          type: 'View',
          props: { onPress: () => undefined, accessibilityLabel: 'Inner' },
          children: [],
        },
      ],
    };
    expect(auditTree(nested, 'fixture')).toHaveLength(1);
  });
});
