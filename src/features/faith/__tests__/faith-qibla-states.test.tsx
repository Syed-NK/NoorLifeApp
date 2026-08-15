import AsyncStorage from '@react-native-async-storage/async-storage';
import { render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';

import { warmUpFirstMount } from '@/test-support/mock-latency-timers';

import type { FaithRepositories } from '../data';
import type { HeadingReading, LocationPort } from '../data/location/location.port';
import { createMockFaithRepositories } from '../data/mock';
import { createAdhanPrayerTimesRepository } from '../data/prayer/adhan-prayer-times.repository';
import type { Coordinate } from '../data/prayer-times.repository';
import { qiblaBearing } from '../data/qibla/qibla';
import { FaithRepositoryProvider } from '../di/faith-repository-context';
import { QiblaScreen } from '../screens/qibla-screen';

/**
 * **Which of the two Qibla screens the user is actually looking at.**
 *
 * ── The claim these cases defend ────────────────────────────────────────────
 * The screen has two runtime states, and the difference between them is not cosmetic — it is what
 * the user is being asked to believe. In **live** the dial is an instrument: the marker points at
 * the Kaaba in the room, and turning the phone moves it. In **bearing-only** there is no
 * trustworthy heading, so the dial is a north-up diagram and nothing more.
 *
 * Every failure mode here is the same failure: bearing-only wearing live's clothes. A "turn left
 * 18°" derived from a heading the platform disowned, a "Compass accuracy · High" for a compass that
 * reported nothing, a "Using device sensors" on a device with no magnetometer — each one tells a
 * person to trust an instrument that is not running, while they are deciding which way to pray.
 *
 * So the fallback cases below assert **absence**, one element per live affordance, rather than
 * checking a single banner. Reintroducing live guidance into bearing-only fails them by
 * construction: there is no way to render the guidance card, the accuracy row, the sensor line or
 * the calibration control in a fallback state without one of these turning red.
 */
warmUpFirstMount(async () => render(<QiblaScreen />));

beforeEach(async () => {
  await AsyncStorage.clear();
});

const MANCHESTER: Coordinate = { latitude: 53.4808, longitude: -2.2426 };

function fakeLocationPort(overrides: Partial<LocationPort> = {}): LocationPort {
  return {
    getPermission: async () => 'granted',
    requestPermission: async () => 'granted',
    getLastKnownPosition: async () => null,
    getCurrentPosition: async () => ({ coordinate: MANCHESTER, accuracyMetres: 20 }),
    describe: async () => 'Manchester, United Kingdom',
    search: async () => [],
    hasCompass: async () => true,
    watchHeading: async () => () => undefined,
    ...overrides,
  };
}

/**
 * The prayer repository is rebuilt on the same port, which is the part worth stating: the mock set
 * constructs its own, so injecting only `location` would leave the thing that resolves the
 * coordinate talking to the real module, and every case would exercise a denied permission
 * regardless of what it set up.
 */
async function renderQibla(port: LocationPort): Promise<typeof screen> {
  const mocks: FaithRepositories = createMockFaithRepositories();
  await render(
    <FaithRepositoryProvider
      repositories={{
        ...mocks,
        location: port,
        prayerTimes: createAdhanPrayerTimesRepository({
          location: port,
          hijriFor: () => '25 Safar 1448 AH',
        }),
      }}
    >
      <QiblaScreen />
    </FaithRepositoryProvider>,
  );
  return screen;
}

function portReporting(
  reading: HeadingReading,
  overrides: Partial<LocationPort> = {},
): LocationPort {
  return fakeLocationPort({
    watchHeading: async (onReading) => {
      onReading(reading);
      return () => undefined;
    },
    ...overrides,
  });
}

/** Every affordance that asserts a *tracking* compass. None may appear in a fallback state. */
const LIVE_ONLY_TESTIDS = [
  'faith-qibla-live',
  'faith-qibla-headline',
  'faith-qibla-guidance',
  'faith-qibla-accuracy',
  'faith-qibla-sensors',
  'faith-qibla-calibrate',
] as const;

/** The three ways a heading goes missing, and how to make each one happen. */
const FALLBACKS = [
  [
    'the device has no compass at all',
    () => fakeLocationPort({ hasCompass: async () => false }),
    /no compass sensor/i,
    false,
  ],
  [
    'the compass reports an accuracy nobody should rotate an arrow by',
    () => portReporting({ trueHeading: 120, magneticHeading: 120, accuracy: 0 }),
    /cannot trust|not reporting a heading/i,
    true,
  ],
  [
    'no true-north reading has arrived',
    () => portReporting({ trueHeading: null, magneticHeading: 42, accuracy: 3 }),
    /no compass heading/i,
    true,
  ],
] as const;

describe('the live state', () => {
  it('renders the live layout when a trusted heading is arriving', async () => {
    const view = await renderQibla(
      portReporting({ trueHeading: 0, magneticHeading: 0, accuracy: 3 }),
    );

    await view.findByTestId('faith-qibla-live');
    expect(view.queryByTestId('faith-qibla-bearing-only')).toBeNull();
    // The dial, the instruction and the sensor attribution are all present.
    expect(view.getByTestId('faith-qibla-dial')).toBeTruthy();
    expect(view.getByTestId('faith-qibla-guidance')).toBeTruthy();
    expect(view.getByTestId('faith-qibla-sensors')).toBeTruthy();
  });

  it('turns the heading into a shortest-turn instruction', async () => {
    // Manchester's Qibla is ~119°. Facing due north, that is a right turn of about that much —
    // never a left turn of ~241°, which is the same rotation the long way round.
    const view = await renderQibla(
      portReporting({ trueHeading: 0, magneticHeading: 0, accuracy: 3 }),
    );

    await view.findByTestId('faith-qibla-guidance');
    await waitFor(() => expect(view.queryByText(/Turn right 1[12]\d°/)).not.toBeNull());
    expect(view.queryByText(/Turn left/)).toBeNull();
  });

  it('states alignment plainly once the phone is pointing at the Kaaba', async () => {
    const bearing = qiblaBearing(MANCHESTER);
    const view = await renderQibla(
      portReporting({ trueHeading: bearing, magneticHeading: bearing, accuracy: 3 }),
    );

    expect(await view.findByText(/You are facing the Qibla/i)).toBeTruthy();
    // And it stops instructing a turn the user has already made.
    expect(view.queryByText(/Turn (left|right)/)).toBeNull();
  });

  it('grades a confident compass as high and offers no calibration busywork', async () => {
    const view = await renderQibla(
      portReporting({ trueHeading: 100, magneticHeading: 100, accuracy: 3 }),
    );

    await view.findByTestId('faith-qibla-accuracy');
    expect(view.getByText('High')).toBeTruthy();
    // Nothing to fix, so nothing is offered.
    expect(view.queryByTestId('faith-qibla-calibrate')).toBeNull();
  });

  it('offers calibration only for a compass that is working but imprecise', async () => {
    const view = await renderQibla(
      portReporting({ trueHeading: 100, magneticHeading: 100, accuracy: 2 }),
    );

    const row = await view.findByTestId('faith-qibla-calibrate');
    expect(String(row.props.accessibilityLabel)).toMatch(/figure of eight/i);
    // It is still a live dial — the compass works, it is merely imprecise.
    expect(view.getByTestId('faith-qibla-live')).toBeTruthy();
  });
});

describe.each(FALLBACKS)('bearing-only when %s', (_name, makePort, reasonPattern, recoverable) => {
  it('renders the bearing-only layout and names the reason', async () => {
    const view = await renderQibla(makePort());

    await view.findByTestId('faith-qibla-bearing-only');
    const banner = view.getByTestId('faith-qibla-bearing-only-banner');
    const message = String(banner.props.accessibilityLabel ?? '');
    expect(message).toMatch(/bearing only/i);
    expect(message).toMatch(/does not track your phone/i);
    // The *specific* reason, not a generic apology — the user can act on the difference.
    expect(message).toMatch(reasonPattern);
  });

  it.each(LIVE_ONLY_TESTIDS)('shows no %s', async (testID) => {
    const view = await renderQibla(makePort());
    await view.findByTestId('faith-qibla-bearing-only');

    expect(view.queryByTestId(testID)).toBeNull();
  });

  it('never instructs a turn or claims alignment', async () => {
    const view = await renderQibla(makePort());
    await view.findByTestId('faith-qibla-bearing-only');

    expect(view.queryByText(/Turn (left|right)/i)).toBeNull();
    expect(view.queryByText(/facing the Qibla/i)).toBeNull();
    expect(view.queryByText(/Using device sensors/i)).toBeNull();
    expect(view.queryByText(/^High$/)).toBeNull();
  });

  it('still shows the bearing, the place and the distance', async () => {
    const view = await renderQibla(makePort());
    await view.findByTestId('faith-qibla-bearing-only');

    // The bearing is correct and usable with a separate compass — the fallback is not an error page.
    expect(view.getByTestId('faith-qibla-bearing-readout')).toBeTruthy();
    expect(view.getByText(/from true north/)).toBeTruthy();
    expect(view.getByTestId('faith-qibla-source')).toBeTruthy();
    expect(view.getByTestId('faith-qibla-distance')).toBeTruthy();
  });

  it(`${recoverable ? 'offers' : 'withholds'} a way back to the live dial`, async () => {
    const view = await renderQibla(makePort());
    await view.findByTestId('faith-qibla-bearing-only');

    /*
      A device with no magnetometer will never produce a heading, so "try live compass" on it is a
      control that cannot succeed — an invitation to keep tapping something broken. The other two
      reasons are genuinely transient, and there the offer is real.
    */
    if (recoverable) {
      expect(view.getByTestId('faith-qibla-recovery')).toBeTruthy();
    } else {
      expect(view.queryByTestId('faith-qibla-recovery')).toBeNull();
    }
  });
});

/**
 * **Nothing on the fallback may read as a control unless it is one.**
 *
 * ── The defect this locks out ───────────────────────────────────────────────
 * The recovery row was titled "Try live compass" and drawn with the accent glyph — an imperative
 * over a filled emerald disc, which is exactly what every real button on this screen looks like. It
 * had no `onPress`, and it never could have: the mode switches to live on its own the instant a
 * trustworthy heading arrives, so there is no action for a handler to perform.
 *
 * The cost is specific rather than cosmetic. A user in bearing-only has just been told the dial does
 * not track their phone; the next thing they see is an apparent remedy. They tap it, nothing
 * happens, and the screen that was being scrupulously honest about its sensor has taught them it is
 * broken — at the moment they are deciding which way to pray.
 *
 * So the row states what is true and waits: the recovery is automatic, and the copy says so. These
 * assert both halves, because either alone permits the defect back — a non-pressable row with
 * imperative copy is the original bug, and a pressable row would be a control this screen has no
 * work for.
 */
describe('the fallback offers no control it cannot honour', () => {
  /** Verbs that promise the user something will happen when they touch the row. */
  const IMPERATIVE = /\b(try|tap|press|open|enable|turn on|switch to|retry|refresh)\b/i;

  it('states the automatic recovery rather than commanding it', async () => {
    // `unusable-accuracy` is recoverable, so this is the state that draws the row at all.
    const view = await renderQibla(
      portReporting({ trueHeading: 120, magneticHeading: 120, accuracy: 0 }),
    );
    await view.findByTestId('faith-qibla-bearing-only');

    const row = view.getByTestId('faith-qibla-recovery');

    /*
      Not announced as a button and carrying no handler. Asserted on the node the screen actually
      renders rather than on the component's props, because the question is what assistive technology
      and a thumb both find there.
    */
    expect(row.props.accessibilityRole).toBeUndefined();
    expect(row.props.onPress).toBeUndefined();

    // And it does not ask for an action, which is the half a structural check cannot see.
    expect(String(row.props.accessibilityLabel)).not.toMatch(IMPERATIVE);
  });

  it('says the switch happens by itself, so the wait is not mistaken for a stall', async () => {
    const view = await renderQibla(
      portReporting({ trueHeading: null, magneticHeading: 42, accuracy: 3 }),
    );
    await view.findByTestId('faith-qibla-bearing-only');

    const label = String(view.getByTestId('faith-qibla-recovery').props.accessibilityLabel);
    expect(label).toMatch(/on its own|automatic/i);
  });
});

describe('the two states share their geometry', () => {
  /**
   * The dial keeps its position and diameter across a mode change.
   *
   * Not a cosmetic concern: the mode can flip while the user is looking at the screen — a compass
   * that starts reporting, or stops being trusted — and a dial that jumped size or place at that
   * moment would read as the app having lost its footing at precisely the moment it is asking to be
   * believed.
   */
  it('draws the dial at the same size in both states', async () => {
    const live = await renderQibla(
      portReporting({ trueHeading: 10, magneticHeading: 10, accuracy: 3 }),
    );
    const liveDial = await live.findByTestId('faith-qibla-dial');
    const liveSize = liveDial.props.style.width;
    live.unmount();

    const fallback = await renderQibla(fakeLocationPort({ hasCompass: async () => false }));
    const fallbackDial = await fallback.findByTestId('faith-qibla-dial');

    expect(typeof liveSize).toBe('number');
    expect(fallbackDial.props.style.width).toBe(liveSize);
    expect(fallbackDial.props.style.height).toBe(liveDial.props.style.height);
  });
});
