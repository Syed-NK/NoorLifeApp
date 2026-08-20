import { useRouter, type Href } from 'expo-router';
import { Image, StyleSheet, View } from 'react-native';

import { AppIcon, PressableScale } from '@ds/components';
import { globalRoutes } from '@application/navigation/routes';
import { profileAvatar } from '@features/home/module-pictograms';
import { iconButtonA11y } from '@shared/utils/a11y';

import { useModule } from '../module-context';
import { moduleLayout, moduleNeutrals, moduleScale } from '../module-tokens';
import { useModuleMetrics } from '../use-module-metrics';
import { ModuleText } from './module-text';

/**
 * How much room each side of the title is reserved for the control clusters.
 *
 * The **larger** of the two sides, applied to both. Back is one 44 dp control; Help and Profile are
 * two of them plus the gap. Reserving the wider cluster on both sides is what keeps the title band
 * symmetric about the screen's centre — reserving each side its own width would centre the band on
 * the *gap between the controls*, which is not the same point and is the very thing the centred
 * title exists to avoid.
 */
export function headerControlReserve(scaled: (value: number) => number): number {
  const target = scaled(moduleLayout.minTouchTarget);
  return Math.max(target, target * 2 + scaled(moduleLayout.headerControlGap));
}

/**
 * The width the title is given, at a screen width — computed, never measured.
 *
 * ── The defect this replaces ────────────────────────────────────────────────
 * The title used to be a **content-sized** box: the layer spanned the header, and the `Text` inside
 * it shrank to whatever its own string measured. That is fine whenever the measurement is right,
 * and on a **cold deep link into a module screen it is not**. The root navigator mounts immediately
 * rather than waiting on font readiness — a deliberate choice, recorded in `app/_layout.tsx`,
 * because gating it put a two-second blank between the native splash and the branded one — so a
 * linked screen can lay out before Poppins is registered. Yoga measures the title in the system
 * fallback face, the box is sized to that, Poppins arrives and draws wider glyphs into a box that
 * never re-measures, and `numberOfLines={1}` ellipsises the difference.
 *
 * Measured on the emulator, opening `noorlifeapp://faith/reader/4` from a force-stopped app: the
 * title node came out 141 px wide and drew `Rea…`, where the same screen reached by tapping through
 * measured 164 px and drew `Reader`. Nothing recovers from it, because nothing invalidates the
 * layout once the font lands.
 *
 * So the box no longer depends on a measurement at all. The title fills a band whose width is
 * arithmetic on the screen width and the control geometry, and the string is centred inside it by
 * `textAlign`. A stale font metric can no longer clip anything, because nothing is asking the font
 * how wide the string is in order to decide how wide the box should be.
 *
 * ── What this changes for long titles ───────────────────────────────────────
 * A title too long for the band now truncates at the band's edge instead of drawing *underneath*
 * the Help and Profile controls, which is what a content-sized box did with a long string on a
 * narrow screen. Both are compromises; only one of them puts text under a tappable control.
 *
 * The band is generous for the titles this app actually uses. At the narrowest supported width it
 * is 140 dp against a `Reader` that measures about 48 dp — and about 63 dp with the header's
 * 1.3× font-scale cap applied. `reader-header-title.test.tsx` asserts that headroom rather than
 * leaving it as arithmetic in a comment.
 */
export function headerTitleBandWidth(screenWidth: number): number {
  const scale = moduleScale(screenWidth);
  const scaled = (value: number): number => Math.round(value * scale);
  return screenWidth - 2 * scaled(moduleLayout.pagePadding) - 2 * headerControlReserve(scaled);
}

export type ModuleHeaderProps = {
  /** Overrides the module name — used on sub-screens ("Prayer Times"). */
  readonly title?: string;
  /**
   * Where the visible back arrow goes, one level up the hierarchy.
   *
   * Supplied by `ModuleScaffold` from `resolveBackDestination`, so a screen never
   * decides the rule for itself: a module home goes up to Main Home, a module child
   * goes up to its module home.
   */
  readonly backHref: Href;
  /** Human-readable destination for the accessibility label, e.g. "Faith". */
  readonly backLabel: string;
  /** Escape hatch for a screen with a genuinely different back meaning. */
  readonly onBack?: () => void;
  readonly testID?: string;
};

/**
 * The header every module screen shares.
 *
 * Order, fixed by the correction brief and applied to all eight modules:
 *
 *     [Back]        [centred title]        [Help] [Profile]
 *
 * ── Why the title is absolutely positioned ──────────────────────────────────
 * "Visually centered relative to the complete screen, not merely the remaining flex area."
 * Those differ: Back is one control on the left and Help+Profile are two on the right, so a
 * flex-centred title sits left of the screen's true centre by half that difference. The title
 * therefore spans the full header width with `textAlign: 'center'`, and the controls sit above
 * it. `pointerEvents: 'none'` on the title keeps it from swallowing taps meant for a control.
 *
 * ── Why Profile is last ─────────────────────────────────────────────────────
 * It used to sit beside Back, which the brief rules out. Both right-hand controls carry the
 * full 44 dp touch target while the avatar itself stays 34–36 dp, so the visible portrait is
 * the reference's size without the tappable area being under-sized. The portrait is the
 * approved `profileAvatar` PNG — never an initial or a letter placeholder.
 *
 * ── Where Back goes ─────────────────────────────────────────────────────────
 * One level up the hierarchy, resolved by `resolveBackDestination` and passed in. A module
 * home goes to Main Home; a module child goes to its module home and never straight to Main
 * Home. See `application/navigation/module-navigation.ts` for why that is a property of the
 * route rather than of the history.
 */
export function ModuleHeader({ title, backHref, backLabel, onBack, testID }: ModuleHeaderProps) {
  const router = useRouter();
  const module = useModule();
  const { dp, pagePadding } = useModuleMetrics();

  const iconSize = dp(moduleLayout.headerIcon);
  const avatarSize = dp(moduleLayout.headerAvatar);
  /** The tappable rectangle: 44 dp, the accessibility minimum on both axes. */
  const target = dp(moduleLayout.minTouchTarget);
  /**
   * The visible disc inside it: 36 dp, as both approved references draw it.
   *
   * Target and visual were the same 44 dp rectangle before, which made the chrome heavier
   * than the reference and left no gap between Help and the profile portrait. Separating
   * them keeps the 44 dp target while the drawn circle matches the design.
   */
  const disc = dp(moduleLayout.headerControl);
  /** Room kept clear each side of the title. Symmetric, so the band centres on the screen. */
  const reserve = headerControlReserve(dp);
  const prefix = testID ?? 'module-header';

  return (
    <View
      style={[
        styles.root,
        { height: dp(moduleLayout.headerHeight), paddingHorizontal: pagePadding },
      ]}
      testID={testID}
    >
      {/*
        The title band: inset from both screen edges by the page padding **and** the wider control
        cluster, so it is centred on the screen and can never reach under a control.

        ── Why the page padding is part of the inset ──────────────────────────
        It was not, and that was the defect. An absolutely-positioned child resolves `left`/`right`
        against its parent's border box, not its content box, so this layer ignored the
        `paddingHorizontal` on the row and extended one `pagePadding` further toward each edge than
        `headerTitleBandWidth` said it did. Measured on a Samsung SM-G556B at 384 dp: the band ran to
        dp 291.9 while the Help control began at dp 275.9 — a 16 dp overlap, exactly the page padding
        — and "Daily Remembrances" was drawn underneath the Help button.

        With the padding included, the rendered band is exactly `headerTitleBandWidth(screenWidth)`.
        The arithmetic and the layout finally describe the same rectangle, which is what lets the
        band-width test mean something about what a user sees.

        `alignItems: 'stretch'` is the other load-bearing part — the `Text` fills the band rather
        than shrinking to its own measured string, which is what makes the title independent of when
        the font finished loading. See `headerTitleBandWidth`.
      */}
      <View
        style={[styles.titleLayer, { left: pagePadding + reserve, right: pagePadding + reserve }]}
        pointerEvents="none"
        testID={`${prefix}-title-band`}
      >
        <ModuleText
          token="headerTitle"
          align="center"
          /*
            Kept, and it is a wrap guard rather than a truncation policy. The header has a fixed
            height, so a title allowed to run to two lines would grow past it and push the screen
            down. With the band above, a short fixed title like `Reader` has more than twice the
            width it needs — so the only strings this can ever shorten are long descriptive ones on
            the narrowest devices, which previously ran *underneath* the controls instead.
          */
          numberOfLines={1}
          // Caps growth so a large OS text size cannot outgrow the band.
          maxFontSizeMultiplier={1.3}
          accessibilityRole="header"
          /*
            The complete title, always, whatever the visible string had to give up to the band's
            width. Stated explicitly rather than relying on the ellipsised `Text` child: a screen
            reader must never be handed "Daily Remembra…", and on the screens where a long title can
            truncate there is also a summary card immediately below carrying the full name visually.
          */
          accessibilityLabel={title ?? module.name}
          testID={`${prefix}-title`}
        >
          {title ?? module.name}
        </ModuleText>
      </View>

      <PressableScale
        /*
          `dismissTo`, not `replace` or `back`.

          `back()` pops history, which exits the app on a cold deep link and skips the
          module home when the user arrived from Main Home's timeline. `replace()` would
          leave a duplicate entry when the destination is already below us in the stack.
          `dismissTo` pops *to* the destination when it is present and replaces when it
          is not — the same visible outcome from any entry point, with no duplicate push.
        */
        onPress={onBack ?? (() => router.dismissTo(backHref))}
        style={[styles.control, { width: target, height: target }]}
        {...iconButtonA11y(`Back to ${backLabel}`)}
        testID={`${prefix}-back`}
      >
        <View
          style={[styles.disc, { width: disc, height: disc, borderRadius: disc / 2 }]}
          pointerEvents="none"
        >
          <AppIcon name="back" size={iconSize} color={moduleNeutrals.textPrimary} />
        </View>
      </PressableScale>

      <View style={[styles.rightCluster, { columnGap: dp(moduleLayout.headerControlGap) }]}>
        <PressableScale
          onPress={() => router.push(module.routes.help)}
          style={[styles.control, { width: target, height: target }]}
          accessibilityRole="button"
          accessibilityLabel={`${module.name} help`}
          accessibilityHint={`Opens help for the ${module.name} module.`}
          testID={`${prefix}-help`}
        >
          <View
            style={[styles.disc, { width: disc, height: disc, borderRadius: disc / 2 }]}
            pointerEvents="none"
          >
            <AppIcon name="help" size={iconSize} color={module.theme.ink} />
          </View>
        </PressableScale>

        <PressableScale
          onPress={() => router.push(globalRoutes.profile)}
          // The target is 44 dp while the portrait stays 34–36 dp, so the visible avatar
          // matches the reference without an under-sized tap area.
          style={[styles.control, { width: target, height: target }]}
          {...iconButtonA11y('Your profile')}
          testID={`${prefix}-profile`}
        >
          <Image
            source={profileAvatar}
            style={{
              width: avatarSize,
              height: avatarSize,
              borderRadius: avatarSize / 2,
              borderWidth: 1,
              borderColor: module.theme.border,
            }}
            resizeMode="cover"
            accessible={false}
          />
        </PressableScale>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'transparent',
  },
  /**
   * The band the title occupies. `left` and `right` are supplied per render from the control
   * geometry; what is fixed here is that the child **stretches** across it rather than centring at
   * its own measured width, and that the band is centred vertically in the header.
   */
  titleLayer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    alignItems: 'stretch',
    justifyContent: 'center',
  },
  rightCluster: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  control: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  /**
   * The bordered white disc both approved references draw around Back and Help.
   *
   * 36 dp, centred inside a 44 dp pressable. The two were the same rectangle before, which
   * drew heavier chrome than the reference and closed the gap to the profile portrait.
   * `pointerEvents: 'none'` keeps the pressable — not the disc — the accessibility node.
   */
  disc: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: moduleNeutrals.surface,
    borderWidth: 1,
    borderColor: moduleNeutrals.border,
  },
});
