import { act, render } from '@testing-library/react-native';

import { STARTUP_PRESENTATION_CEILING_MS } from '@application/startup/startup-machine';
import { StartupPresentationProvider } from '@application/startup/startup-presentation-provider';
import { StartupWaitPresentation } from '@application/startup/startup-wait-presentation';
import { STARTUP_RESOLVING_MESSAGE } from '@features/entry-auth/components/startup-resolving-notice';
import { neutralColors } from '@ds/tokens';

import { pinModuleWindow } from '@/test-support/module-window';

/**
 * **The surface a waiting deep link renders, measured** — issue #58.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Why this is a test and not a screenshot ────────────────────────────────
 * The notice cannot be reached on hardware. Device verification for this issue found every launch
 * path resolving in roughly six seconds or less on both Android targets — and *faster* in airplane
 * mode, because a confirmed-offline launch skips the session attempt entirely. The ten-second ceiling
 * is genuinely hard to reach, which is a good property and an inconvenient one: the surface's layout
 * has no device evidence behind it.
 *
 * The safe ways to slow a launch were tried and did not work. Airplane mode makes it quicker. Strict
 * private DNS pointed at an unresolvable host was measured at the same six seconds, because the
 * connectivity probe reports the dead link before any request is attempted. Emulator network
 * throttling and an HTTP proxy are both excluded — the first has signed this emulator's session out
 * before, and the second is what corrupted session state on an earlier pass.
 *
 * So the geometry is asserted here instead, at the two text sizes the issue named, from the same
 * window-pinning the module-home fit rules use. That is weaker evidence than a device for *colour*
 * and stronger for *bounds*.
 * ═══════════════════════════════════════════════════════════════════════════
 */

function flatten(style: unknown): Record<string, unknown> {
  return (Array.isArray(style) ? style.flat(4) : [style])
    .filter(
      (entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null,
    )
    .reduce<Record<string, unknown>>((all, entry) => ({ ...all, ...entry }), {});
}

/** Mounts the surface with the launch clock already past the ceiling. */
async function renderPastCeiling() {
  const view = await render(
    <StartupPresentationProvider>
      <StartupWaitPresentation />
    </StartupPresentationProvider>,
  );
  await act(async () => {
    jest.advanceTimersByTime(STARTUP_PRESENTATION_CEILING_MS);
    await Promise.resolve();
  });
  return view;
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(0);
});

afterEach(() => {
  jest.useRealTimers();
});

describe('the waiting surface', () => {
  it.each([1, 1.5])(
    'fills the screen and clears the safe area at text size %s',
    async (fontScale) => {
      pinModuleWindow({ fontScale });

      const view = await renderPastCeiling();
      const surface = flatten(view.getByTestId('startup-wait-presentation').props.style);

      /*
      A screen, not a panel. On a deep link there is nothing underneath, so it takes the whole
      viewport and paints the same canvas the root layout does — a transparent surface would show
      whatever the navigator's background happens to be.
    */
      expect(surface.flex).toBe(1);
      expect(surface.backgroundColor).toBe(neutralColors.canvas);
      expect(surface.alignItems).toBe('center');
      expect(surface.justifyContent).toBe('center');

      /*
      Insets applied at both ends. The notice is centred, so only the extremes can collide — a notch
      above and a gesture bar below. Numbers rather than specific values: the inset provider reports
      what the device has, and asserting a particular figure would be asserting the double.
    */
      expect(typeof surface.paddingTop).toBe('number');
      expect(typeof surface.paddingBottom).toBe('number');
      expect(surface.paddingTop as number).toBeGreaterThanOrEqual(0);
      expect(surface.paddingBottom as number).toBeGreaterThanOrEqual(0);

      /* And the message is actually in it, at both sizes. */
      expect(view.getByText(STARTUP_RESOLVING_MESSAGE)).toBeTruthy();
    },
  );
});
