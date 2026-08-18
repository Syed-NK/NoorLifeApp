import { StyleSheet, View } from 'react-native';

import { AppIcon, PressableScale } from '@ds/components';
import { minimumHitSlop } from '@shared/utils/a11y';

import { ModuleHeroArtwork } from '../components/module-hero-artwork';
import { ModuleText } from '../components/module-text';
import { useModule } from '../module-context';
import { faithHeroGeometry, moduleLayout } from '../module-tokens';
import { useModuleMetrics } from '../use-module-metrics';

/** Gold, sampled from the locked artwork's lanterns and the reference's button. */
const GOLD = '#E3BE73';
const GOLD_DEEP = '#C99B45';
/** Ink on the gold button — the reference uses a dark brown-green, not black. */
const GOLD_INK = '#3D2E10';

/**
 * Share of the card width **reserved for the artwork**, which is the stable quantity.
 *
 * ── Why this is now stated as artwork rather than as copy ───────────────────
 * It used to be `COPY_WIDTH_RATIO = 0.57`, and the copy column was given exactly that fraction with
 * `numberOfLines={1}` on the headline. Every revision of that number was a measurement against
 * whichever phrase happened to be the longest at the time — 0.55 against the fixture "Dhuhr 12:35
 * PM", then 0.57 against "Maghrib 10:44 PM". Each was correct until the copy changed.
 *
 * It changed again. The hero now renders a headline for the state where no location has been set,
 * and "Times for where you are" does not fit on one line at any of those ratios — so it shipped
 * ellipsised, as `Times for where …`, which is what the emulator capture shows. A layout tuned to
 * one phrase fails on the next one, and there will always be a next one: a longer prayer name, a
 * translated string, a larger system font.
 *
 * So the fixed quantity is inverted. What genuinely does not change is where the **artwork's**
 * subject begins: the palms and the lit mosque start past 65% of the canvas, and the distant
 * skyline's outer minaret at about 44%. Reserving 38% for the artwork keeps the copy clear of the
 * subject while letting the copy column flex into whatever is left, and the headline shrinks before
 * it truncates.
 *
 * Exported so the layout test measures the value the component uses rather than a copy of it.
 *
 * ── Now an alias, not a definition ──────────────────────────────────────────
 * The value moved to `faithHeroGeometry`, which the nine Faith section heroes read as well. It
 * has to be one number rather than two equal ones: this hero and the section heroes are required
 * to be the same rectangle, and "same" that is maintained by hand is "same until somebody tunes
 * one screen". The name is kept because it is the one the layout test already asserts against.
 */
export const ARTWORK_RESERVE_RATIO = faithHeroGeometry.artworkReserveRatio;

/**
 * How far the headline may shrink before wrapping is preferred to shrinking.
 *
 * 0.8 of the token size, so a two-word headline stays a display line and a long one steps down
 * rather than losing its end. Below this the line stops reading as the hero's headline, and the
 * second line is the better trade — which is why `numberOfLines` is 2 rather than 1.
 *
 * Shared with the section heroes for the same reason the reserve ratio is.
 */
const HEADLINE_MIN_SCALE = faithHeroGeometry.titleMinScale;

export type FaithHeroProps = {
  readonly onViewPrayerTimes: () => void;
  /**
   * Live content, where the screen has resolved some.
   *
   * ── Why these are props and not registry values ─────────────────────────────
   * The registry's `hero` block is static module copy, shared with the module gallery and with
   * every other module's hero. Faith's was `Dhuhr 12:35 PM / May 19, 2025 / 21 Dhul-Qa'dah 1446 AH`
   * — three fabricated facts about the user's day, rendered identically on every device forever.
   *
   * They are overrides rather than replacements because the hero still has to draw *something*
   * while the prayer resource is loading and when no location has been granted. The registry now
   * carries copy that is true in those states, and these props carry the truth when there is one.
   */
  readonly headline?: string;
  readonly support?: string;
  readonly supportSecondary?: string;
  /** Replaces the action's label where the live state calls for a different one. */
  readonly actionLabel?: string;
  readonly testID?: string;
};

/**
 * Faith's next-prayer hero.
 *
 * ── Left-aligned, like every other module ───────────────────────────────────
 * This hero used to centre its copy, because the superseded artwork was symmetrical and
 * there was no quiet side to put text on. `03-faith-hero-left-copy-v2.png` fixes that at
 * the source: the mosque sits right, the left is an unlit green field. So the copy is
 * left-aligned and lives in the left 55%, and Faith stops being the exception.
 *
 * ── The hierarchy ───────────────────────────────────────────────────────────
 *     Next Prayer            eyebrow, gold
 *     Dhuhr 12:35 PM         one line, never wrapped
 *     May 19, 2025
 *     21 Dhul-Qa'dah 1446 AH
 *     [View Prayer Times]
 *
 * ── Why the prayer line stays on one line ───────────────────────────────────
 * The prayer name and time are a single registry string rather than two fields, because
 * two fields is how they end up on two lines. At 20 dp semibold, "Dhuhr 12:35 PM"
 * measures ~132 dp against the 199 dp copy column at the 393 dp reference width, so it
 * fits with room to spare.
 *
 * The size dropped from 24 to 20 dp when the column narrowed from full-width-centred to
 * 55%: at 24 dp the string measured ~158 dp, which fits 199 dp but leaves too little
 * margin once Android's font scale is applied. 20 dp is still well above the accessible
 * minimum for a display line, and `maxFontSizeMultiplier` caps growth at 1.1 rather than
 * switching scaling off.
 *
 * ── Spacing ─────────────────────────────────────────────────────────────────
 * Explicit at both ends and between every group, so the button never touches the prayer
 * line and the eyebrow never touches the card edge, on any device.
 */
export function FaithHero({
  onViewPrayerTimes,
  headline,
  support,
  supportSecondary,
  actionLabel,
  testID,
}: FaithHeroProps) {
  const module = useModule();
  const { dp, contentWidth } = useModuleMetrics();
  const hero = module.hero;

  const resolvedHeadline = headline ?? hero.headline;
  const resolvedSupport = support ?? hero.support;
  /**
   * Empty resolves to nothing rendered, not to an empty line.
   *
   * The second support line is a Hijri date when one is known and absent otherwise, and reserving
   * blank vertical space for a string that is not coming pushes the button down by a row for no
   * reason. The registry's own value can be empty for the same case.
   */
  const resolvedSupportSecondary = supportSecondary ?? hero.supportSecondary ?? '';
  const resolvedActionLabel = actionLabel ?? hero.actionLabel;

  return (
    <View
      style={[
        styles.root,
        {
          /**
           * A floor, not a fixed height — and the one hero for which that is true.
           *
           * ── Why this hero differs from the other nine ───────────────────────
           * The eight baked section heroes and Faith Home's share a rectangle, and eight of them
           * keep `height` exactly: their copy is a fixed title and subtitle, so a taller box would
           * only stretch artwork cut to 144 dp for no reason.
           *
           * This one is the exception because its copy is *live*. It stacks five things whose
           * length nobody controls — the eyebrow, a prayer name and time, a countdown joined to a
           * resolved place name, a Hijri date, and the action. "in 3 hr 53 min • Mountain View,
           * United States" already wraps to two lines at 393 dp, and a longer place name or a
           * raised OS text size adds more. At a fixed 144 the surplus was painted outside the card
           * and cropped: on the emulator at font scale 1.3 the eyebrow lost its top edge and the
           * action pill ran past the card's left padding.
           *
           * `minHeight` costs nothing at ordinary text sizes — the content measures under 144 dp at
           * font scale 1.0, so the card is still exactly 144 and the approved composition is
           * unchanged. It grows only when the text genuinely needs the room, which is the outcome
           * the correction brief asks for: no shortened copy, no capped scaling, no smaller type.
           * The artwork behind it is `cover` at `absoluteFill`, so it fills the taller box rather
           * than leaving a seam.
           */
          minHeight: dp(faithHeroGeometry.height),
          borderRadius: dp(faithHeroGeometry.radius),
          marginHorizontal: dp(faithHeroGeometry.marginHorizontal),
          // Painted behind the artwork so there is no white flash while the PNG decodes,
          // and no seam if `cover` leaves a sub-pixel edge.
          backgroundColor: module.theme.gradientStart,
        },
      ]}
      testID={testID}
    >
      <ModuleHeroArtwork
        source={module.heroArtwork}
        scrim={module.heroScrim}
        copySide={module.heroCopySide}
        testID={`${testID ?? 'faith-hero'}-artwork`}
      />

      <View
        style={[
          styles.copy,
          {
            /**
             * Flexes into whatever the artwork does not need, instead of taking a fixed share.
             *
             * `maxWidth` is the reserve, so the copy can never run into the artwork's subject; there
             * is no `width`, so a short headline does not leave the column artificially narrow and a
             * long one is not forced to truncate inside it.
             */
            maxWidth: contentWidth * (1 - faithHeroGeometry.artworkReserveRatio),
            paddingTop: dp(faithHeroGeometry.paddingTop),
            paddingBottom: dp(faithHeroGeometry.paddingBottom),
            paddingLeft: dp(faithHeroGeometry.paddingLeft),
          },
        ]}
        testID={`${testID ?? 'faith-hero'}-copy`}
      >
        <ModuleText token="eyebrow" color={GOLD} align="left" numberOfLines={1}>
          {hero.eyebrow}
        </ModuleText>

        {/*
          ── Shrink, then wrap, and only then truncate ──────────────────────────
          `adjustsFontSizeToFit` steps the size down to `HEADLINE_MIN_SCALE` before anything else
          happens, and `numberOfLines={2}` gives a genuinely long headline somewhere to go once it
          has stopped shrinking. The previous single line with no shrink is what turned "Times for
          where you are" into "Times for where …" — the meaning was lost to save a line the card had
          room for.

          `maxFontSizeMultiplier` still caps growth at 1.1 so a large system font scale enlarges the
          line without pushing the button out of the card; the shrink handles the other direction.
        */}
        <ModuleText
          token="faithPrayer"
          color={module.theme.onFill}
          align="left"
          numberOfLines={2}
          adjustsFontSizeToFit
          minimumFontScale={HEADLINE_MIN_SCALE}
          maxFontSizeMultiplier={1.1}
          style={{ marginTop: dp(faithHeroGeometry.eyebrowGap) }}
          testID={`${testID ?? 'faith-hero'}-prayer`}
        >
          {resolvedHeadline}
        </ModuleText>

        <View style={{ marginTop: dp(faithHeroGeometry.titleGap) }}>
          {/*
            Two lines each, for the same reason. These carry a date and a Hijri date, and a Hijri
            date at a large font scale — "26 Safar 1448 AH" — is exactly the kind of string that
            fits at the default size and ellipsises at 1.3×.
          */}
          <ModuleText token="rowMeta" color={module.theme.onFill} align="left" numberOfLines={2}>
            {resolvedSupport}
          </ModuleText>
          {resolvedSupportSecondary === '' ? null : (
            <ModuleText token="rowMeta" color={module.theme.onFill} align="left" numberOfLines={2}>
              {resolvedSupportSecondary}
            </ModuleText>
          )}
        </View>

        <PressableScale
          onPress={onViewPrayerTimes}
          accessibilityRole="button"
          accessibilityLabel={resolvedActionLabel}
          style={[
            styles.button,
            {
              marginTop: dp(faithHeroGeometry.actionGap),
              minHeight: dp(moduleLayout.heroButtonHeight),
              borderRadius: dp(moduleLayout.radiusPill),
              paddingHorizontal: dp(12),
              columnGap: dp(5),
            },
          ]}
          // The visible pill is 34 dp so it fits the hero; hit-slop brings the
          // effective target to the 44 dp minimum without growing the artwork box.
          hitSlop={minimumHitSlop(dp(moduleLayout.heroButtonHeight))}
          testID={`${testID ?? 'faith-hero'}-action`}
        >
          <AppIcon name="clock" size={dp(13)} color={GOLD_INK} />
          {/*
            No `numberOfLines`. The pill is `alignSelf: 'flex-start'`, so it sizes to this label and
            the label is never space-constrained — which means a line cap here can only ever cause
            the pixel-rounding truncation described on `styles.copy` ("View Prayer Ti…"), never
            prevent a genuine overflow.
          */}
          <ModuleText token="cardAction" color={GOLD_INK}>
            {resolvedActionLabel}
          </ModuleText>
        </PressableScale>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    // The card owns the radius and does the clipping; the artwork carries neither.
    overflow: 'hidden',
  },
  copy: {
    flex: 1,
    /**
     * `stretch`, not `flex-start` — and the difference is a rendering bug, not a preference.
     *
     * ── Why the eyebrow ellipsised with 148 dp of room beside it ────────────────
     * `flex-start` makes each child shrink-wrap to its **intrinsic** width. Yoga measures that
     * width itself, Android then lays the glyph run out with `StaticLayout`, and the two do not
     * always agree to the pixel. When StaticLayout wants a fraction more than Yoga granted, a
     * `numberOfLines={1}` Text has no room left and truncates.
     *
     * That is measurably what shipped: on the API 36 emulator at font scale 1.0, the eyebrow's
     * text node was **61.7 dp wide inside a 210 dp column** and rendered as "Prayer ti…", and the
     * action's label rendered as "View Prayer Ti…". Neither was short of space; both were short of
     * a pixel. No amount of widening the column fixes that, because the column was never the
     * constraint.
     *
     * `stretch` removes the intrinsic measurement from the path entirely: every line is laid out
     * against the column's full width, so there is nothing to round. Appearance is unchanged —
     * each line still carries `align="left"`, so it draws in exactly the same place.
     *
     * The action keeps `alignSelf: 'flex-start'` so the pill still sizes to its label rather than
     * stretching across the card.
     */
    alignItems: 'stretch',
    justifyContent: 'center',
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
    backgroundColor: GOLD,
    borderWidth: 1,
    borderColor: GOLD_DEEP,
  },
});
