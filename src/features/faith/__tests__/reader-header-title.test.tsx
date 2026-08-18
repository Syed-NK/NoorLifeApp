import AsyncStorage from '@react-native-async-storage/async-storage';
import { configure } from '@testing-library/react-native';

import { seedTranslationPreference } from '@/test-support/faith-preferences-fixtures';
import { renderReader } from '@/test-support/faith-reader';
import { warmUpFirstMount } from '@/test-support/mock-latency-timers';

import {
  headerControlReserve,
  headerTitleBandWidth,
} from '@features/modules/components/module-header';
import { moduleLayout, moduleScale } from '@features/modules/module-tokens';

/**
 * The reader's header says `Reader`, on the frame it first appears and at every supported width.
 *
 * ── The defect ──────────────────────────────────────────────────────────────
 * Opening `noorlifeapp://faith/reader/4` from a force-stopped app drew `Rea…`, and kept drawing it
 * for as long as the screen stayed open. The same screen reached by tapping through drew `Reader`.
 * Measured with `uiautomator dump` on the emulator: the title node came out **141 px** wide through
 * the deep link and **164 px** through navigation, with an identical node height — so the font size
 * was the same and only the box differed.
 *
 * The cause is the two facts in `module-header.tsx`'s note, together: the root navigator mounts
 * before Poppins is registered (deliberately — gating it put a two-second blank between the two
 * splash screens), and the title box was **content-sized**. Yoga measured the string in the system
 * fallback face, sized the box to that, and nothing re-measured when the real face arrived, so
 * `numberOfLines={1}` ellipsised the overflow for the life of the screen.
 *
 * ── What this file can and cannot reproduce ─────────────────────────────────
 * Not the ellipsis. There is no text measurement under Jest — no font is registered, no glyph has a
 * width, and every `Text` reports whatever the mock renderer says. A test that claimed to catch a
 * truncation here would be asserting nothing.
 *
 * What it pins instead is the property that makes the truncation impossible: the title's width is
 * **arithmetic on the screen and the control geometry**, never a measurement of the string, and the
 * band that arithmetic produces has room for this title several times over. That is the fix, stated
 * as the thing a future edit would have to break.
 */

const mockWindow = { width: 393, height: 851, scale: 3, fontScale: 1 };

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => mockWindow,
}));

/** The two ends of the supported range, and the emulator in between. */
const NARROW = 320;
const REFERENCE = 393;
const WIDE = 411;

configure({ asyncUtilTimeout: 3000 });
jest.setTimeout(20000);

warmUpFirstMount(() => renderReader({ surah: '4' }).then(({ view }) => view));

beforeEach(async () => {
  await AsyncStorage.clear();
  await seedTranslationPreference();
  mockWindow.width = REFERENCE;
});

/** Style props as one object, since a React Native `style` may be an array of them. */
function flatten(style: unknown): Record<string, number | string | undefined> {
  const parts = Array.isArray(style) ? style.flat(Infinity) : [style];
  return Object.assign(
    {},
    ...parts.filter((part) => part !== null && typeof part === 'object'),
  ) as Record<string, number | string | undefined>;
}

/**
 * A deliberately pessimistic upper bound on how wide a string can draw.
 *
 * 0.62 em per character. Poppins SemiBold's widest lowercase advances sit near 0.60 em and its caps
 * near 0.70 em; 0.62 across every character of a mixed-case word is well above what `Reader`
 * actually measures — 164 px at 46.8 px on the emulator works out at 0.58 em — and the point of
 * erring high is that the assertion still holds if the face is ever changed for a wider one.
 */
const WIDEST_EM = 0.62;

/** The header's own cap on OS text growth, restated so the bound is checked against it. */
const FONT_SCALE_CAP = 1.3;

function widestRender(text: string, fontSize: number): number {
  return text.length * fontSize * WIDEST_EM * FONT_SCALE_CAP;
}

describe('the reader opened through a deep link', () => {
  it('shows the whole word on the first render, not a truncation of it', async () => {
    /*
      `renderReader` enters the way a link does: the route carries the surah and the screen is the
      first thing mounted, with nothing navigated through on the way in. The assertion is made on
      the first settled render rather than after any interaction.
    */
    const { view } = await renderReader({ surah: '4' });

    const title = await view.findByTestId('faith-reader-header-title');
    expect(title.props.children).toBe('Reader');
    // Nothing shrinks the type to make it fit — the band is sized for it instead.
    expect(title.props.adjustsFontSizeToFit).toBeUndefined();
    expect(title.props.maxFontSizeMultiplier).toBe(FONT_SCALE_CAP);
  });

  it('gives the title a computed band rather than sizing it to the string', async () => {
    const { view } = await renderReader({ surah: '4' });
    const band = await view.findByTestId('faith-reader-header-title-band');
    const style = flatten(band.props.style);

    /*
      The load-bearing assertion of this file. `stretch` is what makes the `Text` fill the band; the
      moment it goes back to `center` the box is content-sized again and the deep-link truncation
      returns — invisibly, because Jest cannot see it.
    */
    expect(style.alignItems).toBe('stretch');
    expect(typeof style.left).toBe('number');
    expect(typeof style.right).toBe('number');
    // No measurement anywhere on the path: the band carries no onLayout.
    expect(band.props.onLayout).toBeUndefined();
  });

  it('centres the band on the screen, not on the space the controls leave over', async () => {
    const { view } = await renderReader({ surah: '4' });
    const style = flatten((await view.findByTestId('faith-reader-header-title-band')).props.style);

    /*
      Back is one control; Help and Profile are two. Reserving each side its own width would centre
      the title on the midpoint *between the clusters*, which sits left of the screen's centre by
      half the difference. Equal insets are what make the band's centre the screen's centre.
    */
    expect(style.left).toBe(style.right);
    expect(style.left).toBe(headerControlReserve((value: number) => Math.round(value)));
  });
});

describe('the band is wide enough at every supported width', () => {
  it.each([
    [NARROW, 'the narrowest handset the layout claims to support'],
    [REFERENCE, 'the module framework’s reference width'],
    [WIDE, 'a wide handset, where the layout scale is capped at 1'],
  ])('holds `Reader` with room to spare at %i dp — %s', async (width) => {
    mockWindow.width = width;
    const { view } = await renderReader({ surah: '4' });

    const title = await view.findByTestId('faith-reader-header-title');
    expect(title.props.children).toBe('Reader');

    const fontSize = Number(flatten(title.props.style).fontSize);
    const band = headerTitleBandWidth(width);

    // Not merely "it fits": the worst case must clear the band by a margin, so the next tweak to
    // the type ramp or the control geometry does not silently land on the edge of truncation.
    expect(band).toBeGreaterThan(widestRender('Reader', fontSize) * 1.5);
  });

  it('reserves the wider control cluster on both sides, at every width', () => {
    for (const width of [NARROW, REFERENCE, WIDE]) {
      const scale = moduleScale(width);
      const scaled = (value: number): number => Math.round(value * scale);
      const target = scaled(moduleLayout.minTouchTarget);

      // Help + Profile + the gap between them — the larger of the two clusters.
      expect(headerControlReserve(scaled)).toBe(target * 2 + scaled(moduleLayout.headerControlGap));
      // And the band is what is left of the screen once both reserves and both paddings are taken.
      expect(headerTitleBandWidth(width)).toBe(
        width - 2 * scaled(moduleLayout.pagePadding) - 2 * headerControlReserve(scaled),
      );
    }
  });

  it('never upscales the reserve above the reference width', () => {
    // `moduleScale` caps at 1, so a wider screen gets a wider band rather than bigger controls.
    expect(headerTitleBandWidth(WIDE) - headerTitleBandWidth(REFERENCE)).toBe(WIDE - REFERENCE);
  });
});
