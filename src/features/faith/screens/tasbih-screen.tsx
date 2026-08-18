import { useCallback, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { AppIcon, PressableScale } from '@ds/components';
import { ModuleStatusBanner, ModuleText } from '@features/modules/components';
import { ModuleCard } from '@features/modules/components/module-card';
import { ModuleProgressBar } from '@features/modules/components/module-chart';
import { useModuleTheme } from '@features/modules/module-context';
import { moduleLayout, moduleNeutrals } from '@features/modules/module-tokens';
import { useModuleMetrics } from '@features/modules/use-module-metrics';

import { ArabicText, FaithRow, FaithRowGroup } from '../components/faith-list';
import { FaithIdentity } from '../components/faith-identity';
import { FaithScreen } from '../components/faith-screen';
import type { DhikrPreset, TasbihSession } from '../data/tasbih.repository';
import { useFaithRepositories } from '../di/faith-repository-context';
import { faithNavKeys } from '../faith-routes';
import { useTasbih } from '../hooks/use-tasbih';

/**
 * The tasbih counter — a genuinely working local feature.
 *
 * ── Design decisions worth recording ────────────────────────────────────────
 * The count button is the largest touch target on the screen because it is tapped a
 * hundred times in a row, and a small one turns dhikr into a precision task.
 *
 * Reset is confirmed through a native `Alert` rather than an inline "are you sure"
 * toggle: it is destructive, it discards something the user built up deliberately, and a
 * two-step inline control is exactly the thing a thumb hits by accident while counting.
 *
 * The count is announced with `accessibilityLiveRegion` so a screen-reader user hears the
 * number change without re-focusing the button.
 */
export function TasbihScreen() {
  const { dp } = useModuleMetrics();
  const { tasbih } = useFaithRepositories();
  const { session, presets, error, increment, decrement, reset, choosePreset } = useTasbih();
  const [showPresets, setShowPresets] = useState(false);

  void tasbih;

  const preset = presets.find((item) => item.id === session?.presetId) ?? presets[0] ?? null;

  const confirmReset = useCallback(() => {
    Alert.alert(
      'Reset the counter?',
      'Your current count will be saved to today’s history and the counter will return to zero.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Reset', style: 'destructive', onPress: () => void reset() },
      ],
    );
  }, [reset]);

  return (
    <FaithScreen title="Tasbih" activeKey={faithNavKeys.more} testID="faith-tasbih">
      <View style={{ rowGap: dp(moduleLayout.sectionGap) }}>
        <FaithIdentity submenu="tasbih" summary="Count your dhikr. Saved on this device." />

        {error === null ? null : (
          <ModuleStatusBanner
            tone="error"
            message="Your count could not be saved to this device. It may not survive a restart."
            testID="faith-tasbih-write-error"
          />
        )}

        {preset === null || session === null ? (
          <ModuleCard testID="faith-tasbih-loading">
            <ModuleText token="body">Preparing your counter…</ModuleText>
          </ModuleCard>
        ) : (
          <>
            <Counter preset={preset} session={session} onCount={() => void increment()} />

            <View style={[styles.controls, { columnGap: dp(10) }]}>
              <SecondaryControl
                label="Undo"
                icon="retry"
                onPress={() => void decrement()}
                testID="faith-tasbih-undo"
              />
              <SecondaryControl
                label="Change dhikr"
                icon="more"
                onPress={() => setShowPresets((value) => !value)}
                testID="faith-tasbih-change"
              />
              <SecondaryControl
                label="Reset"
                icon="close"
                destructive
                onPress={confirmReset}
                testID="faith-tasbih-reset"
              />
            </View>

            {showPresets ? (
              <FaithRowGroup title="Choose a dhikr" testID="faith-tasbih-presets">
                {presets.map((item) => (
                  <FaithRow
                    key={item.id}
                    title={item.transliteration}
                    subtitle={`${item.translation} • target ${item.target}`}
                    arabic={item.arabic}
                    onPress={() => {
                      void choosePreset(item.id);
                      setShowPresets(false);
                    }}
                    accessibilityLabel={`${item.transliteration}, ${item.translation}, target ${item.target}`}
                    testID={`faith-tasbih-preset-${item.id}`}
                  />
                ))}
              </FaithRowGroup>
            ) : null}
          </>
        )}
      </View>
    </FaithScreen>
  );
}

function Counter({
  preset,
  session,
  onCount,
}: {
  readonly preset: DhikrPreset;
  readonly session: TasbihSession;
  readonly onCount: () => void;
}) {
  const theme = useModuleTheme();
  const { dp } = useModuleMetrics();
  const size = dp(190);

  return (
    <ModuleCard testID="faith-tasbih-counter">
      <View style={{ rowGap: dp(10), alignItems: 'center' }}>
        <ArabicText size="display" testID="faith-tasbih-arabic">
          {preset.arabic}
        </ArabicText>
        <ModuleText token="cardTitle" align="center" numberOfLines={1}>
          {preset.transliteration}
        </ModuleText>
        <ModuleText token="caption" align="center" numberOfLines={2}>
          {preset.translation}
        </ModuleText>

        <PressableScale
          onPress={onCount}
          accessibilityRole="button"
          accessibilityLabel={`Count. Currently ${session.count} of ${session.target}.`}
          accessibilityHint="Adds one to the counter."
          style={[
            styles.countButton,
            {
              width: size,
              height: size,
              borderRadius: size / 2,
              backgroundColor: theme.lightSurface,
              borderColor: theme.border,
              marginTop: dp(6),
            },
          ]}
          testID="faith-tasbih-count"
        >
          <ModuleText
            token="heroScore"
            color={theme.ink}
            align="center"
            numberOfLines={1}
            accessibilityLiveRegion="polite"
            style={{ fontSize: dp(56), lineHeight: dp(64) }}
            testID="faith-tasbih-count-value"
          >
            {String(session.count)}
          </ModuleText>
          <ModuleText token="caption" align="center" numberOfLines={1}>
            {`of ${session.target}`}
          </ModuleText>
        </PressableScale>

        <View style={{ alignSelf: 'stretch', marginTop: dp(8) }}>
          <ModuleProgressBar
            value={session.target === 0 ? 0 : session.count / session.target}
            accessibilityLabel={`${session.count} of ${session.target} in this round`}
            testID="faith-tasbih-progress"
          />
        </View>

        <ModuleText token="caption" align="center" numberOfLines={1} testID="faith-tasbih-rounds">
          {session.rounds === 0
            ? 'No completed rounds yet'
            : `${session.rounds} round${session.rounds === 1 ? '' : 's'} completed`}
        </ModuleText>
      </View>
    </ModuleCard>
  );
}

function SecondaryControl({
  label,
  icon,
  onPress,
  destructive = false,
  testID,
}: {
  readonly label: string;
  readonly icon: 'retry' | 'more' | 'close';
  readonly onPress: () => void;
  readonly destructive?: boolean;
  readonly testID: string;
}) {
  const theme = useModuleTheme();
  const { dp } = useModuleMetrics();
  const tint = destructive ? moduleNeutrals.error : theme.ink;

  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[
        styles.secondary,
        {
          minHeight: dp(moduleLayout.minTouchTarget),
          borderRadius: dp(moduleLayout.radiusSmall),
          borderColor: destructive ? moduleNeutrals.error : theme.border,
          rowGap: dp(3),
          paddingVertical: dp(8),
        },
      ]}
      testID={testID}
    >
      <AppIcon name={icon} size={dp(18)} color={tint} />
      <ModuleText token="caption" color={tint} align="center" numberOfLines={1}>
        {label}
      </ModuleText>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  controls: {
    flexDirection: 'row',
  },
  countButton: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
  },
  secondary: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    backgroundColor: moduleNeutrals.surface,
  },
});
