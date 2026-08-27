import { Image, StyleSheet, View } from 'react-native';

import { AppIcon, PressableScale } from '@ds/components';
import { noorLifeAssets } from '@shared/assets/noorlife-assets';

import { useModule } from '../module-context';
import { moduleLayout, moduleNeutrals } from '../module-tokens';
import { useModuleMetrics } from '../use-module-metrics';
import { ModuleText } from './module-text';

export type ModuleInsightBannerProps = {
  readonly title: string;
  readonly body: string;
  /** The line under the body: a source attribution, or a disclaimer. */
  readonly footnote?: string;
  /**
   * How the footnote reads.
   *
   * `pill` is Faith's bordered "Source: Sahih Bukhari" chip; `plain` is Health's quiet
   * "This is general information, not medical advice." line. The two references treat the
   * same slot differently, so the caller chooses.
   */
  readonly footnoteStyle?: 'pill' | 'plain';
  /** `chevron` opens the module AI (Faith); `info` explains the disclaimer (Health). */
  readonly trailing?: 'chevron' | 'info';
  /** The robot sits in a filled rounded square (Health) or bare on the tint (Faith). */
  readonly artworkTreatment?: 'bare' | 'tile';
  readonly onPress: () => void;
  readonly testID?: string;
};

/**
 * The module AI insight card, as both approved references draw it.
 *
 * Replaces the framework's generic insight card, which put a full-width filled button
 * under the text. Neither reference has that button: Faith ends with a chevron, Health
 * with an ⓘ, and both keep the whole card tappable instead.
 *
 * The card is always attributed — robot mark plus the assistant's own name — so an
 * AI-generated statement is never mistaken for a recorded fact. The footnote is where
 * Health's medical disclaimer lands, and the AI policy already requires that module to
 * carry one.
 */
export function ModuleInsightBanner({
  title,
  body,
  footnote,
  footnoteStyle = 'plain',
  trailing = 'chevron',
  artworkTreatment = 'bare',
  onPress,
  testID,
}: ModuleInsightBannerProps) {
  const module = useModule();
  const { dp } = useModuleMetrics();

  const robot = dp(moduleLayout.insightRobot);

  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={
        footnote === undefined ? `${title}. ${body}` : `${title}. ${body}. ${footnote}`
      }
      style={[
        styles.card,
        {
          borderRadius: dp(moduleLayout.cardRadius),
          padding: dp(moduleLayout.cardPadding),
          backgroundColor: module.theme.wellSurface,
          borderColor: module.theme.border,
          columnGap: dp(10),
        },
      ]}
      testID={testID}
    >
      {artworkTreatment === 'tile' ? (
        <View
          style={{
            width: robot,
            height: robot,
            borderRadius: dp(14),
            backgroundColor: module.theme.border,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Image
            source={noorLifeAssets.entryAuth.noorAiRobot}
            style={{ width: robot * 0.82, height: robot * 0.82 }}
            resizeMode="contain"
            accessible={false}
          />
        </View>
      ) : (
        <Image
          source={noorLifeAssets.entryAuth.noorAiRobot}
          style={{ width: robot, height: robot }}
          resizeMode="contain"
          accessible={false}
        />
      )}

      <View style={[styles.text, { rowGap: dp(3) }]}>
        <ModuleText token="cardTitle" color={module.theme.ink} numberOfLines={1}>
          {title}
        </ModuleText>
        <ModuleText token="body" numberOfLines={3}>
          {body}
        </ModuleText>

        {footnote === undefined ? null : footnoteStyle === 'pill' ? (
          <View
            style={[
              styles.pill,
              {
                marginTop: dp(3),
                borderRadius: dp(moduleLayout.radiusPill),
                borderColor: module.theme.border,
                paddingHorizontal: dp(8),
                paddingVertical: dp(3),
              },
            ]}
          >
            <ModuleText token="caption" numberOfLines={1}>
              {footnote}
            </ModuleText>
          </View>
        ) : (
          <ModuleText
            token="caption"
            color={moduleNeutrals.textTertiary}
            numberOfLines={2}
            style={{ marginTop: dp(2) }}
          >
            {footnote}
          </ModuleText>
        )}
      </View>

      <AppIcon
        name={trailing === 'chevron' ? 'chevron-forward' : 'info-outline'}
        size={dp(trailing === 'chevron' ? 18 : 16)}
        color={moduleNeutrals.textTertiary}
        style={trailing === 'info' ? styles.trailingBottom : undefined}
      />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
  },
  text: {
    flex: 1,
    minWidth: 0,
  },
  pill: {
    alignSelf: 'flex-start',
    backgroundColor: moduleNeutrals.surface,
    borderWidth: 1,
  },
  /** Health draws its ⓘ at the card's lower-right, level with the disclaimer. */
  trailingBottom: {
    alignSelf: 'flex-end',
  },
});
