import fs from 'node:fs';
import path from 'node:path';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { render, screen } from '@testing-library/react-native';
import React from 'react';

import { fontFamilies, modulePalettes, shadowCard, shadowRaised } from '@ds/tokens';
import { ModuleProvider } from '@features/modules/module-context';
import { moduleNeutrals, moduleType } from '@features/modules/module-tokens';
import { seedPrayerLocation } from '@/test-support/faith-location-fixtures';
import { warmUpFirstMount } from '@/test-support/mock-latency-timers';

import {
  PrayerJourneyTimeline,
  type PrayerJourneyEntry,
} from '../components/prayer-journey-timeline';
import { shouldStackPrayerActions } from '../components/prayer-action-cards';
import { PrayerNextSummary } from '../components/prayer-next-summary';
import { createMockFaithRepositories } from '../data/mock';
import { FaithRepositoryProvider } from '../di/faith-repository-context';
import { faithPictogramSlot, getFaithPictogram } from '../faith-pictogram-assets';
import { PrayerTimesScreen } from '../screens/prayer-times-screen';

/**
 * The Prayer screen is the approved **timeline** composition, and the arc dashboard is gone.
 *
 * ── What was replaced, and why it is asserted as an absence ─────────────────
 * The previous screen drew a semicircular day arc with six markers spaced around it and a
 * two-column time grid, both inside one combined "Today" card. That presentation was rejected. It is
 * asserted absent here rather than merely untested, because a rejected layout that leaves its
 * components in the tree is one import away from coming back.
 *
 * ── The division of labour with the device captures ────────────────────────
 * These cases assert structure, wiring, live data and semantics — the things a tree can answer.
 * Pixel proportions are settled by the captures in `docs/screenshots/faith-mock-b-timeline/`,
 * because jsdom has no layout engine and a dp assertion here would be a restatement of the source.
 */

warmUpFirstMount(() => renderScreen());

async function renderScreen() {
  await render(
    <FaithRepositoryProvider repositories={createMockFaithRepositories()}>
      <PrayerTimesScreen />
    </FaithRepositoryProvider>,
  );
  return screen;
}

const ORDER = ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'] as const;

type TreeNode = { props?: Record<string, unknown>; children?: unknown[] };

/** Every `testID` in the tree, in depth-first order — which is the order assistive tech walks it. */
function testIDsInOrder(root: unknown): readonly string[] {
  const found: string[] = [];
  const walk = (node: TreeNode): void => {
    const id = node.props?.testID;
    if (typeof id === 'string') found.push(id);
    for (const child of node.children ?? []) {
      if (typeof child === 'object' && child !== null) walk(child as TreeNode);
    }
  };
  walk(root as TreeNode);
  return found;
}

/**
 * A row's spoken utterance, from whichever node carries it.
 *
 * ── Why that is not always the row itself ──────────────────────────────────
 * A row with a notification button cannot be one accessible node: on Android `accessible`
 * collapses the subtree, and the button would vanish from the accessibility tree entirely — the
 * release defect `FaithRowProps.trailingInteractive` documents. So when the Prayer screen renders
 * the card, the utterance sits on the row's summary node and the button is its own node. Where the
 * card is rendered without the callback, the row is still one node and carries it directly.
 *
 * Reading whichever node has it keeps these assertions about the behaviour — every row states its
 * name, time and state in one utterance — rather than about which element holds the string.
 */
function rowUtterance(key: string): string {
  const summary = screen.queryByTestId(`faith-prayer-journey-${key}-summary`, {
    includeHiddenElements: true,
  });
  const fromSummary = summary?.props.accessibilityLabel;
  if (typeof fromSummary === 'string') {
    return fromSummary;
  }
  return String(
    screen.getByTestId(`faith-prayer-journey-${key}`, { includeHiddenElements: true }).props
      .accessibilityLabel,
  );
}

/**
 * The notification buttons' labels, which are interleaved between the rows in tree order.
 *
 * Filtered out where a case is asserting the *rows*, so that adding a per-row control does not
 * silently change what a sequence assertion is comparing.
 */
const NOTIFY_BUTTON_LABEL = 'Notification settings for ';

/** Every `accessibilityLabel` in a subtree, in the same order. */
function labelsInOrder(root: unknown): readonly string[] {
  const found: string[] = [];
  const walk = (node: TreeNode): void => {
    const label = node.props?.accessibilityLabel;
    if (typeof label === 'string') found.push(label);
    for (const child of node.children ?? []) {
      if (typeof child === 'object' && child !== null) walk(child as TreeNode);
    }
  };
  walk(root as TreeNode);
  return found;
}

beforeEach(async () => {
  await AsyncStorage.clear();
  await seedPrayerLocation();
});

describe('the rejected arc dashboard is gone', () => {
  it('renders no arc, no arc caption, no combined Today card and no time grid', async () => {
    await renderScreen();
    await screen.findByTestId('faith-prayer-journey');

    for (const gone of [
      'faith-prayer-arc',
      'faith-prayer-arc-drawing',
      'faith-prayer-arc-caption',
      'faith-prayer-today',
      'faith-prayer-today-heading',
      'faith-prayer-list',
      'faith-prayer-divider-ornament',
    ]) {
      expect(screen.queryByTestId(gone, { includeHiddenElements: true })).toBeNull();
    }
  });

  it('leaves no arc or grid component in the module for a screen to import', () => {
    for (const file of [
      'src/features/faith/components/prayer-day-arc.tsx',
      'src/features/faith/components/prayer-times-grid.tsx',
    ]) {
      expect(fs.existsSync(path.join(process.cwd(), file))).toBe(false);
    }
  });
});

describe('the next-prayer summary is live', () => {
  it('names whichever prayer the repository says is next, at its own clock time', async () => {
    await renderScreen();
    const line = await screen.findByTestId('faith-prayer-next-prayer');

    // A real prayer and a real clock, whichever the day yields — never a fixed pair.
    expect(String(line.props.children)).toMatch(
      /^(Fajr|Sunrise|Dhuhr|Asr|Maghrib|Isha) at \d{1,2}:\d{2} (AM|PM)$/,
    );
  });

  it('states the countdown in words as well as in the ring', async () => {
    await renderScreen();
    const remaining = await screen.findByTestId('faith-prayer-next-remaining');

    expect(String(remaining.props.children)).toMatch(/^(now|(\d+ hr )?\d+ (hr|min) remaining)$/);
  });

  /**
   * The ring is a proportion, so it is drawn from the real interval or not at all.
   *
   * ── Why this no longer samples the current interval ─────────────────────
   * It used to render the screen, accept whatever proportion the live Makkah day happened to yield,
   * and assert that the head and the sweep agreed about it. The property is right; the sampling was
   * not. At almost every hour there is a sweep and the case passes, so a defect present in the first
   * ~1/120 of *every* interval survived nine days and was then caught by chance in CI — a 101-second
   * window after Dhuhr (issue #39).
   *
   * The invariant below is unchanged, down to the line that states it. What changed is that both of
   * its branches are now reached deliberately, by passing fixed proportions into the same card the
   * screen builds — same component, same three testIDs, no clock, no repository. The boundary either
   * side of half a segment is enumerated in `prayer-progress-ring-boundary.test.tsx`.
   */
  it.each([
    ['a proportion large enough to draw', 0.5, true],
    ['a proportion too small to draw a segment', 0, false],
    ['no knowable interval', null, false],
  ])(
    'draws the ring’s track always and its sweep only when the interval is known: %s',
    async (_label, progress, sweptSomething) => {
      await render(
        <ModuleProvider moduleId="faith">
          <PrayerNextSummary
            pictogram={faithPictogramSlot('p2-asr')}
            prayerName="Asr"
            clock="4:15 PM"
            remaining="2 hr 5 min remaining"
            remainingLines={['2 hr', '5 min']}
            dayRelation="today"
            progress={progress}
            testID="faith-prayer-next"
          />
        </ModuleProvider>,
      );

      expect(
        screen.getByTestId('faith-prayer-next-ring-track', { includeHiddenElements: true }),
      ).toBeTruthy();

      const head = screen.queryByTestId('faith-prayer-next-ring-head', {
        includeHiddenElements: true,
      });
      const firstSegment = screen.queryByTestId('faith-prayer-next-ring-sweep-0', {
        includeHiddenElements: true,
      });
      expect(head === null).toBe(firstSegment === null);

      // And which branch it is, so neither case can quietly stop being covered.
      expect(firstSegment === null).toBe(!sweptSomething);
    },
  );

  /**
   * The screen still has to wire the ring, at whatever hour the suite runs.
   *
   * Only the track is asserted here, because it is the one part of the ring that is unconditional —
   * which is exactly why it is the part a screen-level case can assert without depending on the
   * clock. What the sweep and head do with the proportion is settled above and in the boundary suite.
   */
  it('renders the ring inside the live card on the screen', async () => {
    await renderScreen();
    await screen.findByTestId('faith-prayer-next');

    expect(
      screen.getByTestId('faith-prayer-next-ring-track', { includeHiddenElements: true }),
    ).toBeTruthy();
  });

  it('hard-codes none of the reference’s values in the Prayer sources', () => {
    const strip = (file: string) =>
      fs
        .readFileSync(path.join(process.cwd(), file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');

    for (const file of [
      'src/features/faith/screens/prayer-times-screen.tsx',
      'src/features/faith/components/prayer-next-summary.tsx',
      'src/features/faith/components/prayer-journey-timeline.tsx',
      'src/features/faith/components/prayer-action-cards.tsx',
      'src/features/faith/components/prayer-progress-ring.tsx',
    ]) {
      const source = strip(file);
      expect(source).not.toMatch(/1:14\s*PM/i);
      expect(source).not.toMatch(/8\s*hr\s*29/i);
      expect(source).not.toMatch(/['"`]\s*Dhuhr\s*['"`]/);
      expect(source).not.toMatch(/Mountain\s+View/);
      expect(source).not.toMatch(/Muslim\s+World\s+League/);
    }
  });
});

describe('the vertical journey holds the whole day, in order', () => {
  it('renders six rows under one card', async () => {
    await renderScreen();
    await screen.findByTestId('faith-prayer-journey');

    expect(screen.getByText('Today’s prayer journey')).toBeTruthy();
    for (const key of ORDER) {
      expect(screen.getByTestId(`faith-prayer-journey-${key}`)).toBeTruthy();
    }
  });

  it('announces them chronologically', async () => {
    await renderScreen();
    const card = await screen.findByTestId('faith-prayer-journey');

    const names = labelsInOrder(card)
      .filter((label) => !label.startsWith(NOTIFY_BUTTON_LABEL))
      .map((label) => label.split(/[,\s]/)[0]);
    expect(names.slice(0, 6)).toEqual(['Fajr', 'Sunrise', 'Dhuhr', 'Asr', 'Maghrib', 'Isha']);
  });

  it.each([
    ['fajr', 'p2-fajr'],
    ['sunrise', 'p2-sunrise'],
    ['dhuhr', 'p2-dhuhr'],
    ['asr', 'p2-asr'],
    ['maghrib', 'p2-maghrib'],
    ['isha', 'p2-isha'],
  ] as const)('%s uses its own approved marker, %s', async (key, slot) => {
    await renderScreen();
    await screen.findByTestId('faith-prayer-journey');

    const expected = faithPictogramSlot(slot);
    expect(expected.kind).toBe('png');
    if (expected.kind !== 'png') return;
    expect(
      screen.getByTestId(`faith-prayer-journey-${key}-pictogram`, { includeHiddenElements: true })
        .props.source,
    ).toBe(expected.source);
  });

  it('gives every row a distinct image rather than one generic marker', async () => {
    await renderScreen();
    await screen.findByTestId('faith-prayer-journey');

    const sources = ORDER.map(
      (key) =>
        screen.getByTestId(`faith-prayer-journey-${key}-pictogram`, {
          includeHiddenElements: true,
        }).props.source,
    );
    expect(new Set(sources).size).toBe(6);
  });

  /**
   * Every row states its name, its live time and its state — in one utterance.
   *
   * The state is in *words*, not carried by the highlight colour, which is what makes the timeline
   * legible to a screen reader and to a reader who cannot separate emerald from grey.
   */
  it('exposes name, state and live time on each row', async () => {
    await renderScreen();
    await screen.findByTestId('faith-prayer-journey');

    for (const key of ORDER) {
      const label = rowUtterance(key);
      expect(label).toMatch(/\d{1,2}:\d{2} (AM|PM)/);
      expect(label).toMatch(/(next prayer|completed|passed|later today)$/);
    }
  });

  /**
   * The rail spans the row, which is what makes the track visible at all.
   *
   * Without `alignSelf: 'stretch'` the rail sizes to the disc — its only in-flow child — so the two
   * absolutely-positioned track halves span the disc rather than the row and are drawn entirely
   * beneath the marker. The timeline then renders as six unconnected circles. That is a layout
   * defect a jsdom tree cannot *see*, but the property that prevents it is one it can read.
   */
  it('stretches the rail to the row so the track has height to span', async () => {
    await renderTimeline([
      row('fajr', 'passed', true),
      row('sunrise', 'upcoming', false),
      row('dhuhr', 'next', true),
      row('asr', 'upcoming', true),
      row('maghrib', 'upcoming', true),
      row('isha', 'upcoming', true),
    ]);

    const above = screen.getByTestId('journey-dhuhr-track-above', { includeHiddenElements: true });
    const rail = above.parent;
    const style = Object.assign(
      {},
      ...(Array.isArray(rail?.props.style) ? rail?.props.style : [rail?.props.style]),
    ) as { alignSelf?: string };
    expect(style.alignSelf).toBe('stretch');

    // And the track above the next marker is the completed one, because Sunrise is not the bound.
    expect(
      screen.getByTestId('journey-isha-track-above', { includeHiddenElements: true }),
    ).toBeTruthy();
    expect(
      screen.queryByTestId('journey-fajr-track-above', { includeHiddenElements: true }),
    ).toBeNull();
    expect(
      screen.queryByTestId('journey-isha-track-below', { includeHiddenElements: true }),
    ).toBeNull();
  });

  it('emphasises the live next prayer and nothing else', async () => {
    await renderScreen();
    const card = await screen.findByTestId('faith-prayer-journey');

    const emphasised = labelsInOrder(card).filter((label) => label.endsWith(', next prayer'));
    // Exactly one row, or none at all once the day is over — never two.
    expect(emphasised.length).toBeLessThanOrEqual(1);

    /*
      And the two states are not interchangeable: the card names tomorrow's prayer *only* when no row
      is highlighted, and highlights exactly one row whenever it does not. Without this pairing the
      case above would pass on a screen that highlighted nothing at any hour of the day.
    */
    const dayIsOver =
      screen.queryByTestId('faith-prayer-journey-tomorrow', { includeHiddenElements: true }) !==
      null;
    expect(emphasised.length).toBe(dayIsOver ? 0 : 1);

    const named = emphasised[0];
    if (named !== undefined) {
      // Whichever it is, it is the same prayer the summary card is counting down to.
      const summary = String(
        screen.getByTestId('faith-prayer-next-prayer', { includeHiddenElements: true }).props
          .children,
      );
      expect(summary.startsWith(named.split(' ')[0] ?? '')).toBe(true);
      // And Sunrise is never it.
      expect(named).not.toMatch(/^Sunrise/);
    }
  });
});

/**
 * The markers have depth, and the depth belongs to the disc rather than to the artwork.
 *
 * ── What could go wrong, and what these pin ─────────────────────────────────
 * A shadow is the one "make it look dimensional" change that can quietly reach an approved PNG:
 * elevation on the `Image`, or a `tintColor` alongside it, would both read as depth and both would
 * be an edit to artwork the asset contract says is untouchable. So the assertion is two-sided — the
 * wrapper carries it, and the image carries nothing at all.
 */
describe('marker depth sits on the disc, never on the artwork', () => {
  const flatten = (node: { props: { style?: unknown } }): Record<string, unknown> =>
    Object.assign(
      {},
      ...(Array.isArray(node.props.style) ? node.props.style.flat(3) : [node.props.style]),
    ) as Record<string, unknown>;

  it('gives the disc the shared resting-card shadow, not a floating one', async () => {
    await renderScreen();
    await screen.findByTestId('faith-prayer-journey');

    const disc = flatten(
      screen.getByTestId('faith-prayer-journey-fajr-marker', { includeHiddenElements: true }),
    );
    // The locked `shadowCard` token, whichever platform shape it resolved to.
    for (const [property, value] of Object.entries(shadowCard as Record<string, unknown>)) {
      expect({ property, value: disc[property] }).toEqual({ property, value });
    }
    // And not the raised token, which is a floating-control depth.
    expect(disc).not.toMatchObject(shadowRaised as Record<string, unknown>);
  });

  it('leaves the state outline as the marker’s strongest edge', async () => {
    await renderScreen();
    await screen.findByTestId('faith-prayer-journey');

    // Every marker keeps a visible border; the shadow is added beneath it, never instead of it.
    for (const key of ORDER) {
      const disc = flatten(
        screen.getByTestId(`faith-prayer-journey-${key}-marker`, { includeHiddenElements: true }),
      );
      expect(disc.borderWidth).toBeGreaterThanOrEqual(1);
      expect(typeof disc.borderColor).toBe('string');
      // An opaque fill, which is what stops Android's elevation showing through as a vignette.
      expect(disc.backgroundColor).toBe(moduleNeutrals.surface);
    }
  });

  it('gives the PNG itself no shadow, no elevation and no tint', async () => {
    await renderScreen();
    await screen.findByTestId('faith-prayer-journey');

    for (const key of ORDER) {
      const image = screen.getByTestId(`faith-prayer-journey-${key}-pictogram`, {
        includeHiddenElements: true,
      });
      const style = flatten(image);
      for (const forbidden of [
        'elevation',
        'shadowColor',
        'shadowOpacity',
        'shadowRadius',
        'shadowOffset',
        'tintColor',
        'backgroundColor',
        'borderWidth',
      ]) {
        expect({ key, forbidden, value: style[forbidden] }).toEqual({
          key,
          forbidden,
          value: undefined,
        });
      }
      expect(image.props.tintColor).toBeUndefined();
    }
  });

  it('still hands the renderer the registry’s own source for every marker', async () => {
    await renderScreen();
    await screen.findByTestId('faith-prayer-journey');

    for (const key of ORDER) {
      const slot = faithPictogramSlot(`p2-${key}`);
      expect(slot.kind).toBe('png');
      if (slot.kind !== 'png') continue;
      expect(
        screen.getByTestId(`faith-prayer-journey-${key}-pictogram`, { includeHiddenElements: true })
          .props.source,
      ).toBe(slot.source);
    }
  });

  it('keeps the next marker’s gold ring and its size emphasis', async () => {
    await renderTimeline([
      row('fajr', 'passed', true),
      row('sunrise', 'passed', false),
      row('dhuhr', 'next', true),
      row('asr', 'upcoming', true),
      row('maghrib', 'upcoming', true),
      row('isha', 'upcoming', true),
    ]);

    const next = flatten(
      screen.getByTestId('journey-dhuhr-marker', { includeHiddenElements: true }),
    );
    const ordinary = flatten(
      screen.getByTestId('journey-asr-marker', { includeHiddenElements: true }),
    );

    expect(next.borderColor).toBe(modulePalettes.faith.supporting);
    expect(next.borderWidth as number).toBeGreaterThan(ordinary.borderWidth as number);
    expect(next.width as number).toBeGreaterThan(ordinary.width as number);
  });
});

describe('Sunrise is a time marker, never a prayer', () => {
  it('says so on the row, in words', async () => {
    await renderScreen();
    await screen.findByTestId('faith-prayer-journey');

    expect(screen.getByText('Time marker • not a prayer')).toBeTruthy();
    expect(rowUtterance('sunrise')).toMatch(/time marker, not a prayer/);
  });

  it('keeps its chronological place between Fajr and Dhuhr', async () => {
    await renderScreen();
    const card = await screen.findByTestId('faith-prayer-journey');

    const expected = ORDER.map((key) => `faith-prayer-journey-${key}`);
    const rows = testIDsInOrder(card).filter((id) => expected.includes(id));
    expect(rows).toEqual(expected);
  });

  it('carries no completion badge, even once it has passed', async () => {
    await renderTimeline([
      row('fajr', 'passed', true),
      row('sunrise', 'passed', false),
      row('dhuhr', 'next', true),
      row('asr', 'upcoming', true),
      row('maghrib', 'upcoming', true),
      row('isha', 'upcoming', true),
    ]);

    // "Completed" is a claim about an act of worship; Sunrise is a clock reading.
    expect(
      screen.queryByTestId('journey-fajr-completed', { includeHiddenElements: true }),
    ).toBeTruthy();
    expect(
      screen.queryByTestId('journey-sunrise-completed', { includeHiddenElements: true }),
    ).toBeNull();
  });
});

/**
 * The day boundary, asserted on the component so the state is reachable deterministically.
 *
 * After Isha the next prayer is tomorrow's Fajr. The screen resolves the highlight by looking that
 * instant up in *today's* list, finds nothing, and hands every row `passed` — so this is exactly
 * what the card is given at that hour.
 */
describe('after Isha, the day boundary is stated rather than faked', () => {
  it('highlights no row and names tomorrow’s prayer instead', async () => {
    await renderTimeline(
      ORDER.map((key) => row(key, 'passed', key !== 'sunrise')),
      'Today’s prayers are complete. Next is Fajr tomorrow at 4:45 AM.',
    );

    expect(
      labelsInOrder(screen.getByTestId('journey')).filter((label) =>
        label.endsWith(', next prayer'),
      ),
    ).toEqual([]);
    expect(screen.getByTestId('journey-tomorrow')).toBeTruthy();
    expect(screen.getByText(/Today’s prayers are complete/)).toBeTruthy();
  });

  it('says nothing about tomorrow on an ordinary day', async () => {
    await renderTimeline([
      row('fajr', 'passed', true),
      row('sunrise', 'passed', false),
      row('dhuhr', 'next', true),
      row('asr', 'upcoming', true),
      row('maghrib', 'upcoming', true),
      row('isha', 'upcoming', true),
    ]);

    expect(screen.queryByTestId('journey-tomorrow', { includeHiddenElements: true })).toBeNull();
  });
});

/**
 * The action cards' compact one-line hierarchy, and the global token it must not have cost.
 *
 * ── Why the token is asserted, not just the card ────────────────────────────
 * The obvious way to fit "Calculation method" on one line in a 176 dp column is to make
 * `moduleType.cardHeading` smaller. That token sets card headings across the whole module layer, so
 * doing it there would shrink headings on screens nobody looked at to fix a card here. The size is
 * therefore a local style on this one component, and this block is what stops a future edit taking
 * the easier route.
 */
describe('the action cards use a local title size, not a smaller global token', () => {
  /*
    Scoped to each card by testID. Searching the whole screen for "Calculation method" also finds the
    development provenance panel, which prints it as the name of a slot it audits — matching that
    would be the assertion passing against the wrong node.
  */
  const TITLES = [
    ['faith-prayer-calculation-settings-title', 'Calculation method'],
    ['faith-prayer-reminders-action-title', 'Prayer reminders'],
  ] as const;

  /** The style a `ModuleText` actually resolved, flattened out of its style array. */
  const resolvedStyle = (node: { props: { style?: unknown } }): Record<string, unknown> =>
    Object.assign(
      {},
      ...(Array.isArray(node.props.style) ? node.props.style.flat(3) : [node.props.style]),
    ) as Record<string, unknown>;

  it('leaves the shared cardHeading token exactly where it was', () => {
    // 12/17 at the 393 dp baseline. If this changes, every card heading in the app changed with it.
    expect(moduleType.cardHeading).toEqual([12, 17]);
  });

  it('sets both titles below the token size while keeping Poppins SemiBold', async () => {
    await renderScreen();
    await screen.findByTestId('faith-prayer-actions');

    for (const [card, title] of TITLES) {
      const node = screen.getByTestId(card, { includeHiddenElements: true });
      expect(String(node.props.children)).toBe(title);
      const style = resolvedStyle(node);
      expect(style.fontSize).toBe(10.5);
      expect(style.fontFamily).toBe(fontFamilies.semiBold);
    }
  });

  it('gives a card heading elsewhere in the module the untouched token size', async () => {
    await renderScreen();

    // The journey card's heading takes the token, so the override is provably local to the pair.
    const style = resolvedStyle(await screen.findByTestId('faith-prayer-journey-heading'));
    expect(style.fontSize).toBe(12);
  });

  /**
   * Unclipped, at every text size.
   *
   * `numberOfLines` is the ceiling, and it is 2 rather than 1 on purpose: at an enlarged OS text
   * size the one-line fit is impossible, and the honest outcome is a second line, not an ellipsis
   * through the name of a destination. A `1` here — or an `ellipsizeMode` — would be the defect.
   */
  it('lets the titles wrap rather than truncate', async () => {
    await renderScreen();
    await screen.findByTestId('faith-prayer-actions');

    for (const [card, title] of TITLES) {
      const node = screen.getByTestId(card, { includeHiddenElements: true });
      expect(String(node.props.children)).toBe(title);
      expect(node.props.numberOfLines).toBe(2);
      expect(node.props.ellipsizeMode).toBeUndefined();
    }
  });
});

describe('the two action cards', () => {
  it('open their real destinations', async () => {
    await renderScreen();

    for (const testID of ['faith-prayer-calculation-settings', 'faith-prayer-reminders-action']) {
      expect((await screen.findByTestId(testID)).props.accessibilityRole).toBe('button');
    }
  });

  it('states the live calculation method under its own title', async () => {
    await renderScreen();
    const card = await screen.findByTestId('faith-prayer-calculation-settings');

    /*
      Asserted on the card's own label rather than by text: the development provenance panel also
      prints "Calculation method" as the name of a slot it audits, and matching that would be the
      test passing for the wrong reason.
    */
    expect(String(card.props.accessibilityLabel)).toMatch(/^Calculation method, currently .+\./);
    // The gear is P4, installed, and it is this row's own artwork.
    const slot = faithPictogramSlot('p4');
    expect(slot.kind).toBe('png');
    if (slot.kind !== 'png') return;
    expect(
      screen.getByTestId('faith-prayer-calculation-settings-pictogram', {
        includeHiddenElements: true,
      }).props.source,
    ).toBe(slot.source);
  });

  /**
   * The reminders card keeps the restrained vector, and P3 stays out of the bundle.
   *
   * The held state is not a rendering preference: the destination persists preferences and schedules
   * nothing, so a dimensional gold bell beside it would assert — in the register users read fastest
   * — that reminders work, and somebody would miss a prayer trusting it.
   */
  it('uses the restrained vector rather than the held bell', async () => {
    await renderScreen();
    await screen.findByTestId('faith-prayer-reminders-action');

    expect(
      screen.queryByTestId('faith-prayer-reminders-action-pictogram', {
        includeHiddenElements: true,
      }),
    ).toBeNull();
    expect(faithPictogramSlot('p3').kind).toBe('vector');
    expect(getFaithPictogram('p3').asset.status).toBe('held');
  });

  it('gives P3 no source to render and no require to reach it', () => {
    const entry = getFaithPictogram('p3');
    // A held asset carries no `source` at all, which is stronger than a rule not to use one.
    expect(entry.asset).not.toHaveProperty('source');

    const registry = fs.readFileSync(
      path.join(process.cwd(), 'src/features/faith/faith-pictogram-assets.ts'),
      'utf8',
    );
    expect(registry).not.toMatch(/require\([^)]*p3-reminder-bell/);
  });

  it('says what the destination sets, and claims no delivery', async () => {
    /*
      ── The claim that expired ───────────────────────────────────────────
      This case used to require "Preferences only" and "does not schedule notifications yet".
      Both were accurate while the destination stored switches and delivered nothing; both became
      false when alerts became real scheduled notifications, and the card went on saying them.

      The subtitle now describes the settings’ granularity, which is true whatever the platform
      does afterwards. What it may still never say is that a notification will arrive.
    */
    await renderScreen();
    const card = await screen.findByTestId('faith-prayer-reminders-action');

    expect(screen.getByText('Prayer reminders')).toBeTruthy();
    expect(screen.getByText('Per prayer, per day')).toBeTruthy();
    expect(screen.queryByText('Preferences only')).toBeNull();
    expect(String(card.props.accessibilityLabel)).not.toMatch(/does not schedule/i);

    /* Neither the reference’s claim nor a promise of delivery. */
    expect(screen.queryByText('Manage notifications')).toBeNull();
    expect(screen.queryByText('Choose which prayers notify you')).toBeNull();
    expect(String(card.props.accessibilityLabel)).not.toMatch(/will (arrive|notify)/i);
  });

  /**
   * The pair's stacking rule, asserted as arithmetic.
   *
   * Half-column widths are `useModuleMetrics`' own, per supported device width — see
   * `module-two-column-stacking.test.tsx`, which records the same measurements.
   */
  it.each([
    ['411 dp at 1.0', 411, false, false],
    ['411 dp at 1.3', 411, false, false],
    ['600 dp at 1.0', 600, false, false],
    ['393 dp at 1.0', 393, false, false],
    ['411 dp at 1.5', 411, true, true],
    ['360 dp at 1.0', 360, false, true],
    ['320 dp at 1.0', 320, false, true],
  ] as const)('stacks at %s → %s', (_name, width, moduleSaysStack, expected) => {
    expect(shouldStackPrayerActions(width, moduleSaysStack)).toBe(expected);
  });
});

/**
 * The reading order is the approved hierarchy.
 *
 * Assistive technology walks the tree depth-first, so tree order *is* reading order — which is why
 * this is asserted on testIDs rather than on the visual arrangement.
 */
describe('accessibility order', () => {
  it('runs header, hero, location, summary, journey, actions', async () => {
    await renderScreen();
    await screen.findByTestId('faith-prayer-journey');

    const ids = testIDsInOrder(screen.getByTestId('faith-prayer-times'));
    const positionOf = (id: string): number => ids.indexOf(id);

    const sequence = [
      'faith-hero-prayer',
      'faith-prayer-location',
      'faith-prayer-next',
      'faith-prayer-journey',
      'faith-prayer-actions',
    ];
    for (const id of sequence) {
      expect(positionOf(id)).toBeGreaterThanOrEqual(0);
    }
    expect(sequence.map(positionOf)).toEqual([...sequence.map(positionOf)].sort((a, b) => a - b));

    // The header title sits above the hero, which is the top of the scrolling column.
    expect(screen.getByText('Prayer Times')).toBeTruthy();
  });
});

/** Renders the timeline alone, so a state that depends on the hour can be exercised deterministically. */
async function renderTimeline(entries: readonly PrayerJourneyEntry[], note: string | null = null) {
  await render(
    <ModuleProvider moduleId="faith">
      <PrayerJourneyTimeline entries={entries} dayBoundaryNote={note} testID="journey" />
    </ModuleProvider>,
  );
  return screen;
}

function row(
  key: (typeof ORDER)[number],
  state: PrayerJourneyEntry['state'],
  isPrayer: boolean,
): PrayerJourneyEntry {
  return {
    key,
    label: key.charAt(0).toUpperCase() + key.slice(1),
    clock: '5:00 AM',
    pictogram: faithPictogramSlot(`p2-${key}`),
    state,
    isPrayer,
  };
}
