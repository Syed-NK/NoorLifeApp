import { useState } from 'react';
import {
  Image,
  StyleSheet,
  View,
  type ImageSourcePropType,
  type LayoutChangeEvent,
} from 'react-native';

import { PressableScale } from '@ds/components';
import { neutralColors } from '@ds/tokens';

import { LOCKED } from '../main-home-metrics';
import { useMetrics } from '../main-home-metrics-context';
import { HomeText } from './home-text';

/**
 * The approved hero artwork — the complete indigo panel with the robot, day-path, mosque,
 * family, sun, lightbulb and clipboard already composed, and an intentionally empty left
 * area for live text.
 */
const HERO_BACKGROUND =
  require('@assets/images/home/hero-graphics-only-v2.png') as ImageSourcePropType;

/**
 * Locked headline, exactly three lines, breaks fixed by the pack.
 *
 * The breaks are explicit rather than left to the layout engine: the pack fixes them and
 * forbids a different line count, so hard-coding removes any chance of a reflow producing
 * two or four lines.
 */
const HERO_HEADLINE = 'Your family,\nyour day,\nbeautifully in sync.';

/** Star glyph colour on the hero button. */
const STAR_COLOR = '#F5A000';
/** Hero button label colour. */
const BUTTON_TEXT_COLOR = '#142A78';

export type HomeHeroProps = {
  readonly eyebrow: string;
  readonly actionLabel: string;
  readonly onPressAction: () => void;
  readonly testID?: string;
};

/**
 * Main Home hero.
 *
 * The illustration is not reconstructed from components. `hero-graphics-only-v2.png` *is*
 * the hero — full width, 158 dp tall, `cover`, 16 dp radius, clipped — and only the
 * eyebrow, heading and button are live React Native text over its empty left area.
 *
 * ── One copy container ──────────────────────────────────────────────────────
 * All three pieces of left-side content live in a single absolutely positioned container
 * and stack with margins. Previously the title was pinned from the top and the button from
 * the bottom, so at this hero height they closed up on each other; a single flow container
 * makes the 11 dp gap below the title explicit and unconditional.
 *
 * Typography: eyebrow 10.5/14 w500, heading **15/18 w600** with −0.25 letter spacing, button
 * 10.5/14 w600. The heading is semibold, never 700+ — that is what made it read heavier than
 * the approved mock.
 *
 * The heading size is 15 rather than the specified 20.5 because the new three-line sentence is
 * 41% longer than the one the artwork's clear left column was drawn around; at 20.5 dp its
 * third line runs onto the robot's white head and disappears. `LOCKED_TYPE.heroHeadline`
 * carries the measurements behind that number.
 */
export function HomeHero({ eyebrow, actionLabel, onPressAction, testID }: HomeHeroProps) {
  const { dp } = useMetrics();

  /*
    How tall the copy column actually is — issue 115.

    The column is absolutely positioned, which is what keeps it clear of the artwork, and an
    absolute child cannot make its parent grow. So at 320 dp the call to action inside it ran past
    the bottom of the card and was clipped to it: 142 px against the 149 px the floor asks for,
    42.074 dp. Measuring the column is the only honest way to know where it ends, because its
    height depends on how the headline wraps at this width and this font scale.
  */
  const [copyHeight, setCopyHeight] = useState(0);
  const onCopyLayout = (event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout.height;
    setCopyHeight((current) => (Math.abs(current - next) < 0.5 ? current : next));
  };

  return (
    <View
      style={[
        styles.root,
        /*
          A minimum, not a fixed height — the 44 dp accessibility floor, issue 115. The call to
          action inside measured 41.778 dp at 320 dp because this card capped it.
        */
        {
          /*
            The locked height wherever the copy still fits inside it — which is every width the
            hero was drawn at, including the 393 dp reference. It grows only to contain a column
            that would otherwise have its button cut off.
          */
          minHeight: Math.max(
            dp(LOCKED.hero.height),
            dp(LOCKED.hero.copyTop) + copyHeight + dp(LOCKED.hero.copyTop),
          ),
          borderRadius: dp(LOCKED.hero.radius),
        },
      ]}
      testID={testID}
    >
      <Image
        source={HERO_BACKGROUND}
        style={styles.background}
        resizeMode="cover"
        accessible={false}
        testID={`${testID ?? 'home-hero'}-artwork`}
      />

      <View
        style={[
          styles.heroCopy,
          {
            left: dp(LOCKED.hero.copyLeft),
            top: dp(LOCKED.hero.copyTop),
            width: dp(LOCKED.hero.copyWidth),
          },
        ]}
        onLayout={onCopyLayout}
      >
        <HomeText
          token="heroEyebrow"
          color={neutralColors.surface}
          numberOfLines={1}
          style={{ marginBottom: dp(LOCKED.hero.eyebrowMarginBottom) }}
        >
          {eyebrow}
        </HomeText>

        {/*
          No line cap — issue #151.

          It was `numberOfLines={3}`, which matched `HERO_HEADLINE` exactly: the copy is authored as
          three hard-wrapped lines. That cap was right while the authored line count and the *rendered*
          line count were the same number, and they were only the same while Main Home did not scale.
          Once #141 restored scaling, the third authored line stopped fitting the fixed 182 dp copy
          column at a 1.5 text scale, wrapped onto a fourth rendered line, and the cap discarded it —
          the hero read `beautifully in` on both devices and the sentence never finished.

          Nothing replaces it. A cap of four would fail the same way at the next text size up, and the
          alternatives are all worse than a taller card: shrinking the type leaves the locked ramp,
          widening the column runs the copy under the artwork, and a fixed height is the clipping this
          removes. The card already grows from the *measured* copy column above, so the line it needs
          has somewhere to go at any scale.
        */}
        <HomeText
          token="heroHeadline"
          color={neutralColors.surface}
          style={{ marginBottom: dp(LOCKED.hero.titleMarginBottom) }}
          testID={`${testID ?? 'home-hero'}-title`}
        >
          {HERO_HEADLINE}
        </HomeText>

        <PressableScale
          onPress={onPressAction}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          style={[
            styles.button,
            {
              height: dp(LOCKED.hero.buttonHeight),
              paddingHorizontal: dp(LOCKED.hero.buttonPaddingHorizontal),
              borderRadius: dp(LOCKED.hero.buttonRadius),
              columnGap: dp(LOCKED.hero.buttonGap),
            },
          ]}
          testID={`${testID ?? 'home-hero'}-action`}
        >
          {/* A text glyph, not an icon-font component: the pack specifies a star at a
              given size and colour, and this keeps it independent of the icon set. */}
          <HomeText
            token="heroButton"
            color={STAR_COLOR}
            style={{ fontSize: dp(LOCKED.hero.starSize), lineHeight: dp(15) }}
          >
            ★
          </HomeText>
          <HomeText token="heroButton" color={BUTTON_TEXT_COLOR} numberOfLines={1}>
            {actionLabel}
          </HomeText>
        </PressableScale>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    overflow: 'hidden',
    // Subtle depth only; the artwork already carries the hero's visual weight. Kept tight
    // so the shadow does not add measurable height to a card locked at 158 dp.
    shadowColor: '#172033',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  background: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    height: '100%',
  },
  heroCopy: {
    position: 'absolute',
    // Left-aligned flow. Deliberately not `space-between`: the gaps are fixed margins so
    // the spacing cannot change with the container's height.
    alignItems: 'flex-start',
  },
  button: {
    backgroundColor: neutralColors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
