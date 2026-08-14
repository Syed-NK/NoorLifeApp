import fs from 'node:fs';
import path from 'node:path';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { cleanup, render, screen, within } from '@testing-library/react-native';
import React from 'react';

import {
  faithHeroGeometry,
  moduleLayout,
  moduleNavigationHeight,
  moduleType,
} from '@features/modules/module-tokens';
import {
  createRecordingLocationPort,
  repositoriesWithLocationPort,
} from '@/test-support/fake-location-port';
import { warmUpFirstMount } from '@/test-support/mock-latency-timers';

import {
  prayerActionLayout,
  prayerActionMetrics,
  shouldStackPrayerActions,
} from '../components/prayer-action-cards';
import {
  prayerDashboardContentHeight,
  prayerDashboardIsMeasured,
  prayerDashboardMode,
  prayerDashboardSafeBodyHeight,
  prayerDashboardScrollRange,
  prayerLocationMetrics,
} from '../components/prayer-dashboard-fit';
import { prayerJourneyMetrics } from '../components/prayer-journey-timeline';
import { prayerNextMetrics } from '../components/prayer-next-summary';
import { resetActiveLocationRevisionForTest } from '../data/location/active-location';
import { FaithRepositoryProvider } from '../di/faith-repository-context';
import { useOnScreenEntry } from '../hooks/use-top-on-entry';
import { PrayerTimesScreen } from '../screens/prayer-times-screen';
import {
  beginLocationOperation,
  commitActivePrayerLocation,
  resetLocationOperationsForTest,
  resetPrayerLocationSnapshotForTest,
} from '../storage/faith-location';

/**
 * **The compact dashboard, and the entry it is always seen from.**
 *
 * ── The two reported symptoms, and why they are one defect and one constraint ──
 * The screen came back from Prayer Location with its hero above the viewport and the timeline
 * apparently starting under the fixed header. Nothing had restored a scroll position: a popped-to
 * screen is never unmounted, so its scroll region simply kept the offset the user left it at, and
 * nothing reset it. That is the defect, and `useOnScreenEntry` is the policy that closes it.
 *
 * Separately, the approved composition is taller than some viewports, and no amount of scroll
 * discipline changes that. So the second half of this file is about the honest response: choose
 * compact where it genuinely fits, scroll where it does not, and clip nothing either way.
 *
 * ── Why the scroll offset is asserted through the policy rather than the ref ──
 * Under this project's Jest environment `ScrollView` is a function component with no instance, so a
 * ref to it is permanently `null` and `scrollTo` can never be observed. Asserting on it would be
 * asserting that nothing happened. The policy — *when* an entry is declared — is the part that is
 * both observable and the part the correction is about, so that is what these cases drive.
 */

const MAKKAH = { latitude: 21.4225, longitude: 39.8262 };
const DUBAI_CITY = { latitude: 25.07725, longitude: 55.30927 };

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
async function drain(passes = 10): Promise<void> {
  for (let pass = 0; pass < passes; pass += 1) {
    await settle();
  }
}

async function seedDevice(): Promise<void> {
  await commitActivePrayerLocation(
    {
      mode: 'device',
      coordinate: MAKKAH,
      label: 'Makkah, Saudi Arabia',
      resolvedAt: new Date().toISOString(),
      accuracyMetres: 20,
    },
    { operation: beginLocationOperation() },
  );
}

async function seedCity(): Promise<void> {
  await commitActivePrayerLocation(
    {
      mode: 'city',
      coordinate: DUBAI_CITY,
      label: 'Dubai, United Arab Emirates',
      geonamesId: 292223,
      countryCode: 'AE',
      admin1: 'Dubai',
      resolvedAt: new Date().toISOString(),
    },
    { operation: beginLocationOperation() },
  );
}

async function renderDashboard() {
  const fake = createRecordingLocationPort();
  await render(
    <FaithRepositoryProvider repositories={repositoriesWithLocationPort(fake.port)}>
      <PrayerTimesScreen />
    </FaithRepositoryProvider>,
  );
  await drain();
  return fake;
}

warmUpFirstMount(async () => {
  await seedCity();
  const fake = await renderDashboard();
  fake.releaseAll();
  await drain();
});

beforeEach(async () => {
  await AsyncStorage.clear();
  resetPrayerLocationSnapshotForTest();
  resetLocationOperationsForTest();
  resetActiveLocationRevisionForTest();
});

/** The unmeasured half of the rule: what a first frame decides from width and text size alone. */
const unmeasured = (screenWidth: number, fontScale: number) => ({
  screenWidth,
  fontScale,
  viewportHeight: 0,
  contentHeight: 0,
});

describe('choosing compact or overflow', () => {
  it('selects compact at 411 dp and the default text size', () => {
    expect(prayerDashboardMode(unmeasured(411, 1))).toBe('compact');
  });

  it('selects compact at 393 dp and the default text size, until measurement says otherwise', () => {
    expect(prayerDashboardMode(unmeasured(393, 1))).toBe('compact');

    // …and the moment real numbers arrive, they decide. A composition that does not fit scrolls.
    expect(
      prayerDashboardMode({
        screenWidth: 393,
        fontScale: 1,
        viewportHeight: 700,
        contentHeight: 741,
      }),
    ).toBe('overflow');
    expect(
      prayerDashboardMode({
        screenWidth: 393,
        fontScale: 1,
        viewportHeight: 760,
        contentHeight: 741,
      }),
    ).toBe('compact');
  });

  it('selects overflow at 320 dp', () => {
    expect(prayerDashboardMode(unmeasured(320, 1))).toBe('overflow');
  });

  it.each([1.15, 1.3, 1.5])('selects overflow at font scale %s rather than clipping', (scale) => {
    expect(prayerDashboardMode(unmeasured(411, scale))).toBe('overflow');
    /*
      And a measured overflow at a large text size stays overflow — the rule never resolves a text
      size by shrinking something. Nothing in this module has a branch that reduces a type token.
    */
    expect(
      prayerDashboardMode({
        screenWidth: 411,
        fontScale: scale,
        viewportHeight: 700,
        contentHeight: 900,
      }),
    ).toBe('overflow');
  });

  it('lets the measurement overrule the prediction in both directions', () => {
    // Predicted overflow (narrow), measured to fit → compact.
    expect(
      prayerDashboardMode({
        screenWidth: 320,
        fontScale: 1,
        viewportHeight: 900,
        contentHeight: 700,
      }),
    ).toBe('compact');
    // Predicted compact (wide, default text), measured not to fit → overflow.
    expect(
      prayerDashboardMode({
        screenWidth: 430,
        fontScale: 1,
        viewportHeight: 600,
        contentHeight: 700,
      }),
    ).toBe('overflow');
  });

  it('treats an exact fit as fitting, and one dp more as not', () => {
    const base = { screenWidth: 411, fontScale: 1, viewportHeight: 700 };
    expect(prayerDashboardMode({ ...base, contentHeight: 700 })).toBe('compact');
    expect(prayerDashboardMode({ ...base, contentHeight: 701 })).toBe('overflow');
  });

  it('does not treat an unlaid-out screen as measured', () => {
    expect(prayerDashboardIsMeasured(unmeasured(411, 1))).toBe(false);
    expect(prayerDashboardIsMeasured({ ...unmeasured(411, 1), viewportHeight: 800 })).toBe(false);
    expect(
      prayerDashboardIsMeasured({
        screenWidth: 411,
        fontScale: 1,
        viewportHeight: 800,
        contentHeight: 700,
      }),
    ).toBe(true);
  });
});

describe('the safe body is the region between the fixed chrome', () => {
  const dp = (value: number) => value;

  it('removes the status-bar inset, the header, the navigation bar and its gesture inset', () => {
    const height = prayerDashboardSafeBodyHeight({
      screenHeight: 914,
      insetTop: 52,
      insetBottom: 28,
      dp,
    });

    expect(height).toBe(914 - 52 - moduleLayout.headerHeight - moduleNavigationHeight(dp, 28));
    // The gesture inset is counted once, inside the navigation height, and nowhere else.
    expect(moduleNavigationHeight(dp, 28)).toBe(moduleLayout.navHeight + 28);
  });

  it('shrinks as the system insets grow, so a cutout cannot be ignored', () => {
    const shallow = prayerDashboardSafeBodyHeight({
      screenHeight: 914,
      insetTop: 24,
      insetBottom: 24,
      dp,
    });
    const deep = prayerDashboardSafeBodyHeight({
      screenHeight: 914,
      insetTop: 52,
      insetBottom: 28,
      dp,
    });
    expect(deep).toBe(shallow - 32);
  });
});

describe('the screen returns to the top on entry, and only on entry', () => {
  /**
   * The policy under test, mounted in the smallest component that can hold it.
   *
   * A component rather than `renderHook`, which this version of the testing library does not export.
   * It renders nothing: the observable is the spy, not a tree.
   */
  function EntryProbe({
    onEnter,
    resetKey,
  }: {
    readonly onEnter: () => void;
    readonly resetKey: string;
  }) {
    useOnScreenEntry(onEnter, resetKey);
    return null;
  }

  /*
    Every driver awaits a turn of the loop. This environment commits effects after the tick that
    rendered them — a spy read synchronously after `render` sees zero calls whether or not the
    effect is going to run — so an entry is only observable once the loop has been given back.
  */
  async function driveEntries(initialKey: string) {
    const onEnter = jest.fn();
    // `render` and `rerender` both resolve asynchronously in this version of the library, and this
    // environment commits effects after the tick that scheduled them — so both are awaited and a
    // turn of the loop is given back before anything is read.
    const view = await render(<EntryProbe onEnter={onEnter} resetKey={initialKey} />);
    await settle();
    const enter = async (resetKey: string) => {
      await view.rerender(<EntryProbe onEnter={onEnter} resetKey={resetKey} />);
      await settle();
    };
    return { onEnter, enter };
  }

  it('declares an entry when the screen first appears', async () => {
    const { onEnter } = await driveEntries('rev-0.muslim-world-league.standard');
    // Exactly one: mount is a single entry, not a focus and a key-effect racing each other.
    expect(onEnter).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a saved city', 'rev-1.muslim-world-league.standard'],
    ['saved coordinates', 'rev-1.muslim-world-league.standard'],
    ['a switch to device mode', 'rev-1.muslim-world-league.standard'],
    ['a changed calculation method', 'rev-0.umm-al-qura.standard'],
    ['a changed Asr convention', 'rev-0.muslim-world-league.hanafi'],
  ])('declares an entry after %s', async (_name, nextKey) => {
    const { onEnter, enter } = await driveEntries('rev-0.muslim-world-league.standard');
    onEnter.mockClear();

    await enter(nextKey);

    expect(onEnter).toHaveBeenCalledTimes(1);
  });

  it('declares no entry for a countdown tick', async () => {
    const key = 'rev-0.muslim-world-league.standard';
    const { onEnter, enter } = await driveEntries(key);
    onEnter.mockClear();

    /*
      The countdown re-renders this screen every fifteen seconds and changes nothing about which
      location or which convention is being displayed. Three re-renders with the same identity stand
      for three ticks; a reader part-way down an overflowing screen must still be where they were.
    */
    await enter(key);
    await enter(key);
    await enter(key);

    expect(onEnter).not.toHaveBeenCalled();
  });

  it('declares no entry for a background resource refresh', async () => {
    const key = 'rev-3.karachi.hanafi';
    const { onEnter, enter } = await driveEntries(key);
    onEnter.mockClear();

    // A resource settling repaints the cards under the reader. The identity is unchanged, so the
    // reader is not moved.
    await enter(key);

    expect(onEnter).not.toHaveBeenCalled();
  });

  it('declares an entry every time the screen is entered again', async () => {
    /*
      Two mounts of the same screen at the same identity. That is what a bottom-tab return and a pop
      back from Prayer Location produce once the route is rebuilt — and, on a route that was never
      unmounted, what the focus effect runs again. The second entry must reset just as the first did:
      an unchanged `resetKey` is not a reason to leave a reader where a previous visit left them.
    */
    const first = await driveEntries('rev-0.muslim-world-league.standard');
    expect(first.onEnter).toHaveBeenCalledTimes(1);
    /*
      Awaited. `cleanup` is asynchronous in this version, and leaving it un-awaited unmounts the first
      tree part-way through the second render — which empties React's queue for every test after this
      one in the file, the failure mode the Faith suites' `drain` note records at length.
    */
    await cleanup();

    const second = await driveEntries('rev-0.muslim-world-league.standard');
    expect(second.onEnter).toHaveBeenCalledTimes(1);
  });

  /**
   * The wiring, asserted at the source.
   *
   * The behaviour above proves *when* an entry is declared; this proves the dashboard's entry is
   * connected to the scaffold's scroll region. It cannot be proved at runtime here — the ScrollView
   * mock has no instance, so the ref is always `null` — and leaving it unasserted would let the two
   * halves be correct while nothing joined them.
   */
  it('hands its entry-reset ref to the scaffold scroll region', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/features/faith/screens/prayer-times-screen.tsx'),
      'utf8',
    );
    expect(source).toMatch(/const scrollRef = useTopOnEntry\(/);
    expect(source).toMatch(/scrollRef=\{scrollRef\}/);
    // And the key is the identity of what is displayed, not a timer.
    expect(source).toMatch(/\$\{locationRevision\}\.\$\{preferences\.calculationMethod\}/);
  });
});

describe('the fixed chrome and the content it must clear', () => {
  it('renders the header, the scroll region and the navigation as siblings', async () => {
    await seedCity();
    await renderDashboard();

    /*
      Three separate nodes, and the scroll region is neither of the other two. That is what makes the
      header and the navigation *fixed*: the content scrolls inside a box that is a sibling of both,
      so no offset can ever move a card underneath either of them.
    */
    const header = screen.getByTestId('faith-prayer-times-header');
    const scroll = screen.getByTestId('faith-prayer-times-scroll');
    const nav = screen.getByTestId('faith-prayer-times-nav');

    expect(header).toBeTruthy();
    expect(nav).toBeTruthy();
    const insideScroll = (testID: string) =>
      within(scroll).queryByTestId(testID, { includeHiddenElements: true }) !== null;
    expect(insideScroll('faith-prayer-times-header')).toBe(false);
    expect(insideScroll('faith-prayer-times-nav')).toBe(false);
    // The dashboard itself *is* inside it, which is what the two assertions above are contrasted with.
    expect(insideScroll('faith-hero-prayer')).toBe(true);
  });

  it('reserves the whole navigation bar plus breathing room under the last card', async () => {
    await seedCity();
    await renderDashboard();

    const scroll = screen.getByTestId('faith-prayer-times-scroll');
    const padding = Number(
      (scroll.props.contentContainerStyle as { paddingBottom?: number } | undefined)
        ?.paddingBottom ?? 0,
    );

    /*
      The bar is absolutely positioned, so it takes no room in the scaffold's column and draws over
      whatever is beneath it. This padding is the only thing keeping the two action cards reachable,
      and it has to cover the bar's full height — its gesture inset included — not merely the
      breathing room.
    */
    expect(padding).toBeGreaterThanOrEqual(moduleLayout.navHeight);
    expect(padding).toBeGreaterThanOrEqual(
      moduleLayout.navHeight + moduleLayout.scrollBottomInset - 1,
    );
  });

  it('draws the hero at its full approved height rather than a cropped strip', async () => {
    await seedCity();
    await renderDashboard();

    const hero = screen.getByTestId('faith-hero-prayer');
    const style = Array.isArray(hero.props.style)
      ? Object.assign({}, ...hero.props.style.filter(Boolean))
      : hero.props.style;

    // The shared Faith hero rectangle, unchanged: the same box all nine section screens draw.
    expect(style.height).toBe(faithHeroGeometry.height);
    expect(style.height).toBe(moduleLayout.faithHeroHeight);
    // Its artwork is present, so "full height" is not an empty box of the right size.
    expect(screen.getByTestId('faith-hero-prayer-image')).toBeTruthy();
  });
});

describe('nothing was made smaller to reach a fit', () => {
  it('leaves every type token the dashboard renders at its approved size', () => {
    /*
      The exact pairs, restated. A future edit that shrank any of these to buy vertical space would
      fail here rather than shipping as a slightly denser screen nobody measured — which is the
      specific failure mode the correction forbids.
    */
    expect(moduleType.heroTitle).toEqual([19, 26]);
    expect(moduleType.faithPrayer).toEqual([20, 25]);
    expect(moduleType.cardTitle).toEqual([13.5, 19]);
    expect(moduleType.cardHeading).toEqual([12, 17]);
    expect(moduleType.body).toEqual([12.5, 18]);
    expect(moduleType.caption).toEqual([11, 15]);
    expect(moduleType.rowMeta).toEqual([9.5, 13]);
  });

  it('keeps every touch target on the dashboard at or above the approved minimum', async () => {
    expect(moduleLayout.minTouchTarget).toBe(44);

    await seedDevice();
    const fake = await renderDashboard();

    /*
      The device refresh disc is drawn at 36 dp so it fits the location row beside a 48 dp
      pictogram. Its hit-slop is what carries the effective target past the minimum, and 36 + 10 on
      each edge is 56 — so the visible size is a drawing decision and the reachable size is not.
    */
    const refresh = screen.getByTestId('faith-prayer-location-refresh');
    expect(refresh.props.hitSlop).toBe(10);
    expect(36 + 10 * 2).toBeGreaterThanOrEqual(moduleLayout.minTouchTarget);

    /*
      Both action cards are the pressable, and their height is composed rather than restated: one dp
      of border and six of padding on each edge around a 30 dp mark. That is 44 exactly — the
      minimum, reached from the component's own constants so a future padding trim fails here rather
      than shipping a 42 dp target.
    */
    expect(prayerActionMetrics.heightDp).toBeGreaterThanOrEqual(moduleLayout.minTouchTarget);
    expect(screen.getByTestId('faith-prayer-calculation-settings')).toBeTruthy();
    expect(screen.getByTestId('faith-prayer-reminders-action')).toBeTruthy();

    fake.releaseAll();
    await drain();
  });

  it('keeps the timeline row pitch inside the approved band and the disc untouched', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/features/faith/components/prayer-journey-timeline.tsx'),
      'utf8',
    );
    const pitch = Number(/const ROW_MIN_HEIGHT_DP = (\d+(?:\.\d+)?);/.exec(source)?.[1]);
    const disc = Number(/const DISC_DP = (\d+(?:\.\d+)?);/.exec(source)?.[1]);

    // The reference's 48–54 dp band. The correction tightened to its floor and no further.
    expect(pitch).toBeGreaterThanOrEqual(48);
    expect(pitch).toBeLessThanOrEqual(54);
    // The marker itself was not shrunk to buy the space, so the pictograms render as approved.
    expect(disc).toBe(38);
    // And the track between two markers is still visible rather than hairline.
    expect(pitch - disc).toBeGreaterThanOrEqual(8);
  });
});

describe('warnings cost height only where they belong', () => {
  it('lets device warning copy wrap rather than clip', async () => {
    await seedDevice();
    const fake = await renderDashboard();
    fake.releaseAll('timed-out');
    await drain();

    const note = screen.getByTestId('faith-prayer-location-refresh-note');
    /*
      No line cap. A warning that ellipsises is a warning nobody can act on, and this one is the
      longest string the location card can hold — so if anything on the card were going to be
      truncated to preserve a height, it would be this.
    */
    expect(note.props.numberOfLines).toBeUndefined();
    expect(String(note.props.children)).toBe(
      'Could not get a new position just now. Showing the last one.',
    );
  });

  it('gives a saved city no device-warning row at all', async () => {
    await seedCity();
    await renderDashboard();

    /*
      Absent rather than empty. An element rendering an empty string still occupies a line box, so a
      city would carry the height of a warning it can never show — and the correction is explicit
      that city and coordinates modes must not pay for obsolete device commentary.
    */
    expect(
      screen.queryByTestId('faith-prayer-location-refresh-note', { includeHiddenElements: true }),
    ).toBeNull();
    expect(
      screen.queryByTestId('faith-prayer-location-refresh', { includeHiddenElements: true }),
    ).toBeNull();
  });
});

describe('the composition is positioned safely at every size', () => {
  it('introduces no negative offset or absolute positioning on the screen itself', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/features/faith/screens/prayer-times-screen.tsx'),
      'utf8',
    );
    /*
      Scoped to the screen, deliberately. The timeline does use one negative inset and two absolute
      children, and both are legitimate and covered by the case below; what must never appear is a
      *layout* nudged into place at the composition level, because that is the kind that works at one
      device size and overlaps at the next.
    */
    expect(source).not.toMatch(/margin\w*:\s*-/);
    expect(source).not.toMatch(/position:\s*'absolute'/);
    expect(source).not.toMatch(/transform:/);
    expect(source).not.toMatch(/\btop:\s*-/);
  });

  it('matches the timeline highlight inset with an equal padding, so nothing can overlap', async () => {
    await seedCity();
    await renderDashboard();

    const rows = ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'].map((key) =>
      screen.getByTestId(`faith-prayer-journey-${key}`),
    );
    expect(rows).toHaveLength(6);

    for (const row of rows) {
      const style = Array.isArray(row.props.style)
        ? Object.assign({}, ...row.props.style.filter(Boolean))
        : row.props.style;
      if (style?.marginHorizontal === undefined) {
        // An ordinary row: no pull-out, so there is nothing that could be drawn past the card edge.
        continue;
      }
      /*
        The pale-mint band is pulled out to the card's padding and given the same amount back as
        padding, so the row's *contents* do not move when it appears and nothing is drawn outside the
        card. A mismatch here would be content laid out past its parent's edge.
      */
      expect(style.marginHorizontal).toBeLessThanOrEqual(0);
      expect(style.paddingHorizontal).toBe(-style.marginHorizontal);
    }
  });
});

/**
 * **The fit contract, at the configuration it is written against.**
 *
 * ── The measurements these numbers come from ────────────────────────────────
 * Every value below was read off the release build on the Pixel-class emulator with `uiautomator`,
 * not estimated: 1080x2400 px at 420 dpi is 411.4 x 914.3 dp, the status bar and display cutout take
 * 51.8 dp, the module header 54.1, and the navigation bar measured 91.8 dp — which is `navHeight`
 * plus the 23.8 dp gesture inset the app actually receives.
 *
 * That leaves **716.6 dp** between the bottom of the header and the top of the navigation bar, and
 * that is the space the whole dashboard has to live in without scrolling.
 */
const EMULATOR = {
  screenHeight: 914.3,
  insetTop: 51.8,
  /** What `useSafeAreaInsets` reports, derived from the measured 91.8 dp bar rather than assumed. */
  insetBottom: 23.8,
  navigationHeight: 91.8,
  /** The scroll region's own measured height: screen less the status inset and the header. */
  viewportHeight: 808.4,
} as const;

/** dp() at 411 dp, where the module's layout scale is exactly 1 — it never upscales. */
const dpAt411 = (value: number) => Math.round(value);

/** The space between the fixed header and the fixed navigation bar. */
const clearOfNavigation =
  EMULATOR.screenHeight - EMULATOR.insetTop - moduleLayout.headerHeight - EMULATOR.navigationHeight;

describe('the dashboard fits 411 dp at the default text size', () => {
  it('reproduces the measured safe body from the scaffold own tokens', () => {
    /*
      716.6 was read off the device; this derivation lands on 716.7. The tenth of a dp is the gap
      between a measurement taken in whole pixels at 2.625 px/dp and arithmetic done in dp, and
      asserting exact equality would be claiming a precision neither number has. Within half a dp is
      the real guarantee: the tokens describe the device rather than merely resembling it.
    */
    expect(clearOfNavigation).toBeCloseTo(716.6, 0);
    /*
      And the scaffold's full safe-body helper, which also removes the comfort inset, agrees once
      that inset is added back. Two derivations of the same boundary, so a token change cannot move
      one without the other.
    */
    expect(
      prayerDashboardSafeBodyHeight({
        screenHeight: EMULATOR.screenHeight,
        insetTop: EMULATOR.insetTop,
        insetBottom: EMULATOR.insetBottom,
        dp: dpAt411,
      }),
    ).toBeCloseTo(clearOfNavigation, 1);
  });

  it('keeps the whole composition above the navigation with measurable headroom', () => {
    const content = prayerDashboardContentHeight(dpAt411);
    const headroom = clearOfNavigation - content;

    /*
      Two dp is the floor the correction sets, so fractional rounding on a real device can never put
      the last card under the bar. This asserts the headroom exists rather than that it is any
      particular size — a future section that grows by four dp should fail here, loudly.
    */
    expect(headroom).toBeGreaterThanOrEqual(2);
  });

  it('leaves the scroll region with nowhere to travel', () => {
    /*
      Compact mode passes 0 for the comfort inset — see the screen. Without that the content would be
      fourteen dp taller than its box and a screen with every card visible would still scroll.
    */
    expect(
      prayerDashboardScrollRange({
        contentHeight: prayerDashboardContentHeight(dpAt411),
        viewportHeight: EMULATOR.viewportHeight,
        navigationHeight: EMULATOR.navigationHeight,
        comfortInset: 0,
      }),
    ).toBe(0);
  });

  it('composes that height from the values the components actually lay out with', () => {
    // Each section is the component's own exported metric, so the model cannot drift from the build.
    const sections =
      moduleLayout.faithHeroHeight +
      prayerLocationMetrics.heightDp +
      prayerNextMetrics.heightDp +
      prayerJourneyMetrics.heightDp +
      prayerActionMetrics.heightDp;
    expect(prayerDashboardContentHeight(dpAt411)).toBe(sections + moduleLayout.sectionGap * 4);
  });

  it('spaces the five sections with an approved token rather than a tuned literal', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/features/faith/screens/prayer-times-screen.tsx'),
      'utf8',
    );
    // Both stacks — the outer one and the one inside the day — use the same existing token.
    const gaps = [...source.matchAll(/rowGap: dp\(moduleLayout\.(\w+)\)/g)].map((m) => m[1]);
    expect(gaps).toEqual(['sectionGap', 'sectionGap']);
    // Which is a real token, and the next one down from the `cardGap` it replaced.
    expect(moduleLayout.sectionGap).toBe(7);
    expect(moduleLayout.cardGap).toBeGreaterThan(moduleLayout.sectionGap);
  });
});

describe('the action row gives each card the width its own title needs', () => {
  const CONTENT_WIDTH = 361;
  const GAP = moduleLayout.sectionGap;

  function layoutAt(fontScale: number, contentWidth = CONTENT_WIDTH) {
    return prayerActionLayout({
      contentWidth,
      gap: GAP,
      overhead: prayerActionMetrics.overheadDp,
      fontScale,
    });
  }

  it('gives the calculation card more room than the reminders card', () => {
    const layout = layoutAt(1);
    expect(layout.kind).toBe('row');
    if (layout.kind !== 'row') return;

    /*
      Asymmetric, and in the direction the measurement demanded: "Calculation method" is the longer
      title and it was the one that wrapped at the old equal split.
    */
    expect(layout.calculationWidth).toBeGreaterThan(layout.remindersWidth);
    expect(layout.calculationWidth + layout.remindersWidth + GAP).toBeCloseTo(CONTENT_WIDTH, 5);
  });

  it('leaves each title enough column to render on one line', () => {
    const layout = layoutAt(1);
    if (layout.kind !== 'row') return;

    const calculationColumn = layout.calculationWidth - prayerActionMetrics.overheadDp;
    const remindersColumn = layout.remindersWidth - prayerActionMetrics.overheadDp;

    /*
      The requirements are the measured ones — see the component. The old build gave both cards
      108.2 dp, which the reminders title fitted and the calculation title did not.
    */
    expect(calculationColumn).toBeGreaterThanOrEqual(prayerActionMetrics.calculationTitleDp);
    expect(remindersColumn).toBeGreaterThanOrEqual(prayerActionMetrics.remindersTitleDp);
    // And the calculation card now has strictly more column than the width that failed.
    expect(calculationColumn).toBeGreaterThan(108.2);
  });

  it('keeps the method name on the line it already fitted', () => {
    const layout = layoutAt(1);
    if (layout.kind !== 'row') return;
    /*
      The subtitle was never the problem — it measured 13.3 dp, one line, in the 108.2 dp column. This
      guards against a correction that "fixes" the title by starving the card the subtitle sits in.
    */
    expect(layout.calculationWidth - prayerActionMetrics.overheadDp).toBeGreaterThanOrEqual(108.2);
  });

  it('keeps both cards at or above the approved touch target', () => {
    expect(prayerActionMetrics.heightDp).toBe(44);
    expect(prayerActionMetrics.heightDp).toBeGreaterThanOrEqual(moduleLayout.minTouchTarget);
  });

  it.each([1.15, 1.3, 1.5])('stacks rather than shrinking at font scale %s', (scale) => {
    expect(layoutAt(scale).kind).toBe('stacked');
  });

  it('stacks at a narrow width rather than truncating', () => {
    // 320 dp gives a 288 dp content column, which cannot hold both titles beside their furniture.
    expect(layoutAt(1, 288).kind).toBe('stacked');
    expect(shouldStackPrayerActions(320, false)).toBe(true);
  });

  it('never shrinks a font to reach a fit', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/features/faith/components/prayer-action-cards.tsx'),
      'utf8',
    );
    expect(source).not.toMatch(/adjustsFontSizeToFit/);
    expect(source).not.toMatch(/minimumFontScale/);
    expect(source).not.toMatch(/ellipsizeMode/);
  });
});

describe('the trimmed sections stayed inside what the correction allows', () => {
  it('keeps the timeline row pitch at exactly the approved floor', () => {
    expect(prayerJourneyMetrics.rowMinHeightDp).toBe(48);
    expect(prayerJourneyMetrics.discDp).toBe(38);
    expect(prayerJourneyMetrics.rows).toBe(6);
  });

  it('keeps the next-prayer ring inside its own band', () => {
    // The reference's 72–82 dp band; the correction took it to the floor, not below it.
    expect(prayerNextMetrics.ringDp).toBeGreaterThanOrEqual(72);
    expect(prayerNextMetrics.ringDp).toBeLessThanOrEqual(82);
  });

  it('lets the location mark rather than a wrapped caption set the card height', () => {
    /*
      The mark is decorative — the whole card carries the press, so the 44 dp minimum does not apply
      to it — and what matters here is that it is the *taller* of the two things in the row. When the
      caption wrapped it was 51 dp and set the height instead, which cost the dashboard nine dp.
    */
    expect(prayerLocationMetrics.pictogramDp).toBeGreaterThan(prayerLocationMetrics.textDp);
    expect(prayerLocationMetrics.heightDp).toBe(
      prayerLocationMetrics.borderDp +
        prayerLocationMetrics.cardPaddingDp * 2 +
        prayerLocationMetrics.pictogramDp,
    );
  });

  it('leaves the hero untouched', () => {
    expect(moduleLayout.faithHeroHeight).toBe(144);
    expect(faithHeroGeometry.height).toBe(144);
  });
});
