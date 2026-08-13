import { LinearGradient } from 'expo-linear-gradient';
import { Image, StyleSheet, View, type ImageSourcePropType } from 'react-native';

import { AppIcon, PressableScale } from '@ds/components';
import { ModuleText } from '@features/modules/components';
import { useModule } from '@features/modules/module-context';
import { faithHeroGeometry, moduleLayout } from '@features/modules/module-tokens';
import { useModuleMetrics } from '@features/modules/use-module-metrics';
import type { IconName } from '@shared/models/icon';
import { minimumHitSlop } from '@shared/utils/a11y';

import { faithHeroBakedCopy, type FaithHeroImage } from '../faith-hero-images';
import { getFaithSubmenuEntry, type FaithSubmenuKey } from '../faith-submenu-assets';

/**
 * The hero rectangle every Faith section screen opens with.
 *
 * ── What this replaces, and why ─────────────────────────────────────────────
 * `FaithIdentity` — a content-height white card with a 56 dp pictogram beside two lines of text.
 * It did its job (carry the tile's mark onto the screen it opened) but it was not a hero, and the
 * nine section screens consequently opened with a rectangle that shared nothing measurable with
 * Faith Home's. Height, radius, padding, artwork scale and copy positions were all different, so
 * moving between Faith Home and any child read as moving between two products.
 *
 * This is the same rectangle as Faith Home's hero, by construction: every measurement comes from
 * `faithHeroGeometry`, which `FaithHero` also reads. Neither component carries a layout literal,
 * so the two cannot drift apart without a token change that fails the geometry test.
 *
 * ── Why a gradient and not the light card the references draw ───────────────
 * The selected references draw these heroes light — cream ground, navy serif title. Two things
 * rule that out here. Poppins is NoorLife's only Latin face, so the serif that carries most of
 * that treatment's character is not available; and Faith Home's hero, which is the stated
 * reference for "the same rectangle", is an emerald artwork card with white copy and a gold
 * eyebrow. Matching its geometry while inverting its palette would have produced nine screens
 * that measure the same as the home and look nothing like it.
 *
 * So the fill is the module's own gradient — `gradientStart` → `gradientEnd`, the same pair the
 * home hero paints behind its artwork — and the copy is white on it. `gradientStart` is 7.03:1
 * against white, so the eyebrow, title and subtitle all clear AA comfortably at the darkest end
 * and AAA at the lightest.
 *
 * ── Why the pictogram is the artwork ────────────────────────────────────────
 * Each section already owns an approved PNG: the mark from the Faith Home tile that opened it.
 * Reusing it keeps the visual thread from tile → screen that `FaithIdentity` established, and
 * means no screen needs artwork that does not exist. The references' bespoke illustrations (the
 * bead strand, the mosque skyline, the praying hands) have no approved asset behind them and are
 * recorded as gaps rather than substituted with something invented.
 */

/**
 * Where the hero's title and artwork come from.
 *
 * A union rather than three optional fields, because the two cases have genuinely different
 * requirements and the compiler should say so. The eight tile-backed sections need only name
 * themselves — their label, mark and testID all follow from the key. Faith AI has no tile, so it
 * must supply all three, and a union makes forgetting one a type error rather than a hero that
 * renders untitled with no mark.
 */
type FaithSectionHeroIdentity =
  | {
      /** Which section this is. Selects the approved pictogram, its label and the testID stem. */
      readonly submenu: FaithSubmenuKey;
      /** Overrides the tile's own label, where a screen titles itself differently. */
      readonly title?: string;
      /** Overrides the tile's mark. Nothing tile-backed does this. */
      readonly artwork?: ImageSourcePropType;
      readonly testID?: string;
    }
  | {
      readonly submenu?: undefined;
      readonly title: string;
      readonly artwork: ImageSourcePropType;
      readonly testID: string;
    };

export type FaithSectionHeroProps = FaithSectionHeroIdentity & {
  /**
   * A complete approved hero card, with its copy baked into the pixels.
   *
   * ── What supplying this changes ──────────────────────────────────────────────
   * Everything native in the card except the action. The image is drawn edge to edge and the eyebrow,
   * heading, summary and detail are **not rendered** — drawing them would put a second copy of the same
   * words on top of the baked ones. `summary` is still required by the type because every other caller
   * needs it and because it documents what the image says; it simply is not drawn here.
   *
   * The container takes `accessibleName` as its label and the image is marked decorative, so the words
   * are announced exactly once.
   *
   * ── The trade this represents ────────────────────────────────────────────────
   * Baked copy cannot be restyled, translated, reflowed, or scaled by the OS font setting. That is a
   * real cost and it is accepted deliberately: the alternative was compositing separated objects onto a
   * generic background, which rebuilt each card and lost the per-screen lighting and staging the
   * approved artwork carries.
   */
  readonly heroImage?: FaithHeroImage;
  /** One line describing what the screen is for. Sits under the title, up to two lines. */
  readonly summary: string;
  /**
   * Live supporting copy, where the screen has resolved some — a next prayer, a bearing, a count.
   *
   * Optional for the same reason Faith Home's is: the hero has to draw something while the
   * screen's resource is still loading, and a hero that rendered a blank line until data arrived
   * would jump as it landed.
   */
  readonly detail?: string;
  /** A trailing action pill, rendered only when both label and handler are supplied. */
  readonly actionLabel?: string;
  readonly actionIcon?: IconName;
  readonly onAction?: () => void;
};

/** Gold, sampled from the locked hero artwork's lanterns. Same value `FaithHero` uses. */
const GOLD = '#E3BE73';
const GOLD_DEEP = '#C99B45';
/** Ink on the gold pill — a dark brown-green, not black. */
const GOLD_INK = '#3D2E10';

/**
 * Painted under a baked hero image.
 *
 * Sampled from the darkest corner the eight cards share, so the frame before the bitmap composites is
 * the card's own ground rather than the page's near-white.
 */
const HERO_GROUND = '#0B2029';

export function FaithSectionHero({
  submenu,
  title,
  heroImage,
  summary,
  detail,
  actionLabel,
  actionIcon,
  onAction,
  artwork,
  testID,
}: FaithSectionHeroProps) {
  const module = useModule();
  const { dp, contentWidth } = useModuleMetrics();
  // Resolved once, so the three places that need a label/mark/id cannot disagree about which
  // branch of the union they are in.
  const entry = submenu === undefined ? null : getFaithSubmenuEntry(submenu);

  const id = testID ?? `faith-hero-${submenu}`;
  const resolvedTitle = title ?? entry?.label ?? '';
  const resolvedArtwork = artwork ?? entry?.source;
  const pictogram = dp(moduleLayout.faithHeroPictogram);
  const showAction = actionLabel !== undefined && onAction !== undefined;

  if (heroImage !== undefined) {
    return (
      <View
        style={[
          styles.root,
          {
            height: dp(faithHeroGeometry.height),
            borderRadius: dp(faithHeroGeometry.radius),
            marginHorizontal: dp(faithHeroGeometry.marginHorizontal),
            // Behind the bitmap, so a frame where it has not composited shows dark teal, not page white.
            backgroundColor: HERO_GROUND,
          },
        ]}
        /**
         * The container is what a screen reader reads, and it reads the baked words once.
         *
         * `accessible` collapses the subtree, so the decorative image inside cannot be announced
         * separately and the action's own label is not swallowed — the pill sits outside this node's
         * accessibility scope because it is a sibling with its own `accessibilityRole`.
         */
        accessible
        accessibilityLabel={heroImage.accessibleName}
        testID={id}
      >
        {/*
          `cover`, even though the file is already cropped to this exact aspect. The two agree, so it
          changes nothing — it is the guarantee that a re-exported image at a different aspect fills the
          card and crops rather than distorting. Rule 4 forbids stretching, and `cover` is what enforces
          it independently of the asset pipeline.

          Marked decorative twice over: `accessible={false}` and `importantForAccessibility="no"`. The
          container above already carries the words.
        */}
        <Image
          source={heroImage.source}
          /**
           * `absoluteFill` **plus an explicit 100% width and height**, and the second half is not
           * redundant.
           *
           * `StyleSheet.absoluteFill` sets `position` and the four edges but no dimensions. That is
           * enough to size a `View`, and it is not enough to size an `Image`: with no definite width or
           * height an Android `Image` measures at its source's intrinsic size, and `resizeMode` then has
           * no frame to fit into. These files are 1083x432 and carry no `@3x` suffix, so Metro reports
           * them as 1083x432 *dp* — the image rendered three times too large inside a 361 dp card,
           * showing only its top-left third: a giant "Faith" eyebrow and the top of the heading.
           *
           * `100%` resolves against the card, so `cover` has the card's box to work with and the image
           * fills it exactly — the file's aspect and the card's are both 2.507 by construction.
           */
          style={[StyleSheet.absoluteFill, styles.imageFill]}
          resizeMode="cover"
          accessible={false}
          importantForAccessibility="no"
          testID={`${id}-image`}
        />

        {/*
          ── The honest subtitle, where the false baked one used to be ─────────────
          Rendered only for the three locked heroes, into the band the removed subtitle occupied. This is
          the *visible* correction: Hadith's image said "Verified narrations, clearly sourced." and Duas'
          said "Supplications for every part of your day.", neither of which is true while no provider is
          approved. Removing the baked words and drawing the truthful ones is the only fix that works for
          a sighted user — an accessibility label would have left the false statement on screen.

          Positioned by fraction, not by padding token, because it has to line up with text that is part
          of the picture: the baked headings begin at 5.26%–6.65% of the image width, inside the hero's own
          14 dp padding. Fractions scale with the image, so the alignment holds at every width.

          `numberOfLines={2}` with room for two lines in the band, and `adjustsFontSizeToFit` so a large
          OS font setting shrinks rather than clips — the band has fixed height and the card cannot grow.
        */}
        {heroImage.lockedSubtitle === undefined ? null : (
          <View
            style={[
              styles.imageLockedCopy,
              {
                left: `${faithHeroBakedCopy.leftFraction * 100}%`,
                top: `${faithHeroBakedCopy.subtitleTopFraction * 100}%`,
                width: `${faithHeroBakedCopy.widthFraction * 100}%`,
              },
            ]}
            pointerEvents="none"
          >
            <ModuleText
              token="rowMeta"
              color={module.theme.onFill}
              align="left"
              numberOfLines={2}
              adjustsFontSizeToFit
              minimumFontScale={0.8}
              testID={`${id}-locked-subtitle`}
            >
              {heroImage.lockedSubtitle}
            </ModuleText>
          </View>
        )}

        {/*
          The native control, in the region the button was removed from.

          Absolutely positioned rather than in a flow column, because the baked text's position is fixed
          in the bitmap and the pill has to land in the cleared area beneath it — a flex layout would put
          it wherever the (absent) native copy happened to end. The offsets are the hero's own padding
          tokens, so the pill's left edge lines up with the baked text's left edge at every width.
        */}
        {showAction ? (
          <PressableScale
            onPress={onAction}
            accessibilityRole="button"
            accessibilityLabel={actionLabel}
            style={[
              styles.button,
              styles.imageAction,
              {
                bottom: dp(faithHeroGeometry.paddingBottom),
                left: dp(faithHeroGeometry.paddingLeft),
                height: dp(moduleLayout.heroButtonHeight),
                borderRadius: dp(moduleLayout.radiusPill),
                paddingHorizontal: dp(12),
                columnGap: dp(5),
              },
            ]}
            hitSlop={minimumHitSlop(dp(moduleLayout.heroButtonHeight))}
            testID={`${id}-action`}
          >
            {actionIcon === undefined ? null : (
              <AppIcon name={actionIcon} size={dp(13)} color={GOLD_INK} />
            )}
            {/*
              Capped to one line and allowed to shrink. The pill's height is fixed so it fits the cleared
              region, and a wrapped label would grow it out of that region and over the baked subtitle.
            */}
            <ModuleText
              token="cardAction"
              color={GOLD_INK}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.85}
            >
              {actionLabel}
            </ModuleText>
          </PressableScale>
        ) : null}
      </View>
    );
  }

  return (
    <View
      style={[
        styles.root,
        {
          height: dp(faithHeroGeometry.height),
          borderRadius: dp(faithHeroGeometry.radius),
          marginHorizontal: dp(faithHeroGeometry.marginHorizontal),
          // Painted behind the gradient so there is no flash of page background if the
          // gradient's own layer composites a frame late.
          backgroundColor: module.theme.gradientStart,
        },
      ]}
      testID={id}
    >
      <LinearGradient
        colors={[module.theme.gradientStart, module.theme.gradientEnd]}
        // Diagonal, matching the direction the locked hero artwork is lit from.
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      {/*
        The mark sits in the reserved band on the trailing edge, vertically centred, and is
        explicitly not accessible: the title beside it already names the section, so exposing the
        image would make a screen reader announce it twice.
      */}
      <View
        style={[styles.artwork, { width: contentWidth * faithHeroGeometry.artworkReserveRatio }]}
        pointerEvents="none"
      >
        <Image
          source={resolvedArtwork}
          style={{ width: pictogram, height: pictogram }}
          resizeMode="contain"
          accessible={false}
          testID={`${id}-artwork`}
        />
      </View>

      <View
        style={[
          styles.copy,
          {
            /**
             * `maxWidth`, never `width` — see `faithHeroGeometry.artworkReserveRatio`. The copy
             * column flexes into whatever the artwork does not need, so it can never run into the
             * mark and never sits artificially narrow.
             */
            maxWidth: contentWidth * (1 - faithHeroGeometry.artworkReserveRatio),
            paddingTop: dp(faithHeroGeometry.paddingTop),
            paddingBottom: dp(faithHeroGeometry.paddingBottom),
            paddingLeft: dp(faithHeroGeometry.paddingLeft),
          },
        ]}
        testID={`${id}-copy`}
      >
        <ModuleText token="eyebrow" color={GOLD} align="left" numberOfLines={1}>
          {module.name}
        </ModuleText>

        {/*
          Shrink, then wrap, and only then truncate — the same ladder `FaithHero` uses. A title
          steps down to `titleMinScale` before anything else happens, and `numberOfLines={2}` gives
          a genuinely long one somewhere to go once it has stopped shrinking. `maxFontSizeMultiplier`
          caps growth at 1.1 so a large system font scale enlarges the line without pushing the
          content out of a fixed-height card.
        */}
        <ModuleText
          token="faithPrayer"
          color={module.theme.onFill}
          align="left"
          numberOfLines={2}
          adjustsFontSizeToFit
          minimumFontScale={faithHeroGeometry.titleMinScale}
          maxFontSizeMultiplier={1.1}
          style={{ marginTop: dp(faithHeroGeometry.eyebrowGap) }}
          accessibilityRole="header"
          testID={`${id}-title`}
        >
          {resolvedTitle}
        </ModuleText>

        <View style={{ marginTop: dp(faithHeroGeometry.titleGap) }}>
          <ModuleText token="rowMeta" color={module.theme.onFill} align="left" numberOfLines={2}>
            {summary}
          </ModuleText>
          {/*
            Absent rather than blank when there is no live detail yet. Reserving a line for a
            string that is not coming pushes the action down a row for no reason, and the card's
            height is fixed.
          */}
          {detail === undefined || detail === '' ? null : (
            <ModuleText
              token="rowMeta"
              color={module.theme.onFill}
              align="left"
              numberOfLines={2}
              testID={`${id}-detail`}
            >
              {detail}
            </ModuleText>
          )}
        </View>

        {showAction ? (
          <PressableScale
            onPress={onAction}
            accessibilityRole="button"
            accessibilityLabel={actionLabel}
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
            // The visible pill is 34 dp so it fits the hero; hit-slop brings the effective
            // target to the 44 dp minimum without growing the card.
            hitSlop={minimumHitSlop(dp(moduleLayout.heroButtonHeight))}
            testID={`${id}-action`}
          >
            {actionIcon === undefined ? null : (
              <AppIcon name={actionIcon} size={dp(13)} color={GOLD_INK} />
            )}
            {/* No `numberOfLines` — see the matching note in `FaithHero`. */}
            <ModuleText token="cardAction" color={GOLD_INK}>
              {actionLabel}
            </ModuleText>
          </PressableScale>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    // The card owns the radius and does the clipping; the gradient and artwork carry neither.
    overflow: 'hidden',
    justifyContent: 'center',
  },
  artwork: {
    // Pinned to the trailing edge, which is the band the copy column's `maxWidth` keeps clear.
    // Written out rather than spread from `absoluteFillObject` because this box is deliberately
    // *not* a full fill: it has no `left`, so its width is the one the caller measures.
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: {
    flex: 1,
    /**
     * `stretch`, for the reason documented at length on `FaithHero`'s own `copy` style: with
     * `flex-start`, each line shrink-wraps to an intrinsic width that Android's text layout can
     * disagree with by a fraction of a pixel, and a capped line then ellipsises with the column
     * half empty beside it. Laying out against the full column width removes the rounding.
     *
     * The two heroes have to make the same choice here — they are required to be the same
     * rectangle, and a line that truncates on one and not the other is exactly the drift
     * `faithHeroGeometry` exists to prevent.
     */
    alignItems: 'stretch',
    justifyContent: 'center',
  },
  imageFill: {
    // See the note at the call site: an `Image` needs definite dimensions, not just pinned edges.
    width: '100%',
    height: '100%',
  },
  imageLockedCopy: {
    /*
      Absolute, so it lands on the baked layout rather than wherever a flex column would put it. Not
      accessible on its own: the container's `accessibleName` already includes this sentence, so exposing
      it here would announce it twice — which is the specific failure the container's `accessible` flag
      exists to prevent.
    */
    position: 'absolute',
  },
  imageAction: {
    /*
      Positioned against the card rather than flowed, so it lands in the region the gold button was
      removed from. `alignSelf` from `styles.button` is inert on an absolute box; the explicit `left`
      and `bottom` are what place it.
    */
    position: 'absolute',
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
