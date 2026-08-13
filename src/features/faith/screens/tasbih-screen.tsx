import { useCallback, useState } from 'react';
import { Alert, Pressable, StyleSheet, Switch, View } from 'react-native';

import { AppIcon, PressableScale } from '@ds/components';
import { ModuleStatusBanner, ModuleText } from '@features/modules/components';
import { ModuleCard } from '@features/modules/components/module-card';
import { ModuleProgressBar } from '@features/modules/components/module-chart';
import { useModuleTheme } from '@features/modules/module-context';
import { moduleLayout, moduleNeutrals } from '@features/modules/module-tokens';
import { useModuleMetrics } from '@features/modules/use-module-metrics';
import { minimumHitSlop } from '@shared/utils/a11y';

import { ArabicText, FaithRow, FaithRowGroup } from '../components/faith-list';
import { FaithSectionHero } from '../components/faith-section-hero';
import { FaithScreen } from '../components/faith-screen';
import {
  MAX_TASBIH_TARGET,
  MIN_TASBIH_TARGET,
  type DhikrPreset,
  type TasbihSession,
} from '../data/tasbih.repository';
import { faithHeroImages } from '../faith-hero-images';
import { faithNavKeys } from '../faith-routes';
import { useFaithPreferences } from '../hooks/use-faith-preferences';
import { useHaptics } from '../hooks/use-haptics';
import { useTasbih } from '../hooks/use-tasbih';

/** How much a target step changes the round length. */
const TARGET_STEP = 1;
/** And the larger step, for getting from 33 to 300 without sixty taps. */
const TARGET_LEAP = 10;

/**
 * The tasbih counter.
 *
 * ── Tap anywhere, because that is how a tasbih is used ──────────────────────
 * The count target used to be a 190 dp circle in the middle of the screen. That is a precision task
 * repeated a hundred times, often with the phone held loosely and the user's eyes shut — and every
 * miss is a bead lost. The **whole counting area** is now the target: the card, the dhikr text, the
 * number, the space around them. The controls that are not counting — undo, reset, the target
 * stepper — sit outside it and stop the tap from propagating, so a thumb reaching for Undo does not
 * add a bead on the way.
 *
 * ── The haptics are the point of counting without looking ───────────────────
 * A light tick per bead and a distinctly different pattern when the round comes round, which is what
 * lets somebody count with their eyes closed. See `use-haptics.ts`.
 *
 * ── What is persisted ───────────────────────────────────────────────────────
 * Everything: the count, the rounds, the chosen dhikr and the target, all through the repository so
 * a failed write becomes a visible warning rather than a number that vanishes on restart.
 */
export function TasbihScreen() {
  const { dp } = useModuleMetrics();
  const { session, presets, error, increment, decrement, reset, choosePreset, adjustTarget } =
    useTasbih();
  const { preferences, update } = useFaithPreferences();
  const haptics = useHaptics();
  const [showPresets, setShowPresets] = useState(false);

  const preset = presets.find((item) => item.id === session?.presetId) ?? presets[0] ?? null;

  /**
   * One tap, and the haptic that matches what it actually did.
   *
   * ── The rounds are compared, not the count ──────────────────────────────────
   * A completed round is the one moment the feedback differs — the strand coming round feels
   * unmistakably different from a bead, which is what lets somebody count with their eyes shut. It
   * is detected by comparing the rounds this screen was rendering against the rounds the write
   * produced, both ordinary values.
   *
   * An earlier version stashed the previous count in a ref and wrote to it during render. That is a
   * ref access in render — the pattern the React Compiler rejects — and it made the decision from
   * state that had not necessarily been persisted. `increment` returning its session removed the
   * need for either.
   */
  const roundsSoFar = session?.rounds ?? 0;
  const count = useCallback(async () => {
    const next = await increment();
    if (next !== null && next.rounds > roundsSoFar) {
      haptics.completeRound();
    } else {
      haptics.count();
    }
  }, [increment, haptics, roundsSoFar]);

  const confirmReset = useCallback(() => {
    Alert.alert(
      'Reset the counter?',
      'Your current count will be saved to today’s history and the counter will return to zero.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: () => {
            haptics.undo();
            void reset();
          },
        },
      ],
    );
  }, [reset, haptics]);

  return (
    <FaithScreen title="Tasbih" activeKey={faithNavKeys.more} testID="faith-tasbih">
      <View style={{ rowGap: dp(moduleLayout.sectionGap) }}>
        {/* Counter is this screen; the whole counting area below is already the tap target. */}
        <FaithSectionHero
          submenu="tasbih"
          heroImage={faithHeroImages.tasbih}
          summary="Count your dhikr. Saved on this device."
        />

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
            <Counter preset={preset} session={session} onCount={() => void count()} />

            <TargetControl
              target={session.target}
              onAdjust={(delta) => void adjustTarget(delta)}
              testID="faith-tasbih-target"
            />

            <View style={[styles.controls, { columnGap: dp(10) }]}>
              <SecondaryControl
                label="Undo"
                icon="retry"
                onPress={() => {
                  haptics.undo();
                  void decrement();
                }}
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

            <FaithRowGroup testID="faith-tasbih-settings">
              {[
                <FaithRow
                  key="haptics"
                  title="Vibrate on each count"
                  subtitle="A light tick per bead, and a different one at the end of a round"
                  trailing={
                    <Switch
                      value={preferences.hapticsEnabled}
                      onValueChange={(value) => void update({ hapticsEnabled: value })}
                      accessibilityLabel="Vibrate on each count"
                      testID="faith-tasbih-haptics"
                    />
                  }
                  testID="faith-tasbih-haptics-row"
                />,
              ]}
            </FaithRowGroup>

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

/**
 * The counting surface.
 *
 * ── The whole card counts ───────────────────────────────────────────────────
 * `Pressable` wraps everything: the Arabic, the transliteration, the translation, the number and the
 * space between them. There is no inner button, because an inner button is a thing to miss.
 *
 * ── The three renderings of the phrase stay distinct ────────────────────────
 * Arabic in the script, transliteration in Latin letters, and the meaning in English are three
 * different kinds of statement and are never run together into one line. A screen reader gets them
 * as one label, in that order, so the sequence is the same by ear as by eye.
 */
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

  return (
    <Pressable
      onPress={onCount}
      accessibilityRole="button"
      accessibilityLabel={`Count ${preset.transliteration}. ${session.count} of ${session.target}.`}
      accessibilityHint="Adds one. The whole card is the button."
      testID="faith-tasbih-count"
    >
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

          <ModuleText
            token="heroScore"
            color={theme.ink}
            align="center"
            numberOfLines={1}
            accessibilityLiveRegion="polite"
            style={{ fontSize: dp(64), lineHeight: dp(72), marginTop: dp(8) }}
            testID="faith-tasbih-count-value"
          >
            {String(session.count)}
          </ModuleText>
          <ModuleText token="caption" align="center" numberOfLines={1}>
            {`of ${session.target}`}
          </ModuleText>

          <View style={{ alignSelf: 'stretch', marginTop: dp(8) }}>
            <ModuleProgressBar
              value={session.target === 0 ? 0 : session.count / session.target}
              accessibilityLabel={`${session.count} of ${session.target} in this round`}
              testID="faith-tasbih-progress"
            />
          </View>

          {/*
            The loop count. A physical tasbih has no memory of completed strands, which is exactly
            why an app should keep one — it is the thing a person loses track of.
          */}
          <ModuleText token="caption" align="center" numberOfLines={1} testID="faith-tasbih-rounds">
            {session.rounds === 0
              ? 'No completed rounds yet'
              : `${session.rounds} round${session.rounds === 1 ? '' : 's'} completed`}
          </ModuleText>
        </View>
      </ModuleCard>
    </Pressable>
  );
}

/**
 * The round length.
 *
 * ── Why it sits outside the counting surface ────────────────────────────────
 * Anything inside the card adds a bead when pressed. These controls must not, so they live below it
 * — which also means a stepper press cannot be mistaken for a count by somebody watching the number.
 */
function TargetControl({
  target,
  onAdjust,
  testID,
}: {
  readonly target: number;
  /**
   * Applies a delta rather than setting a value.
   *
   * A press computes `target ± step` from the *rendered* target, so five quick presses all read the
   * same starting number and the value moves once. Handing the repository the delta makes every
   * press count — which is what a stepper has to do, because people press them fast.
   */
  readonly onAdjust: (delta: number) => void;
  readonly testID: string;
}) {
  const { dp } = useModuleMetrics();

  return (
    <View style={[styles.target, { columnGap: dp(8) }]} accessible={false} testID={testID}>
      <ModuleText token="caption" numberOfLines={1} style={styles.flex}>
        Round length
      </ModuleText>
      <StepButton
        label={`Decrease the round length by ${TARGET_LEAP}`}
        glyph="chevron-back"
        disabled={target <= MIN_TASBIH_TARGET}
        onPress={() => onAdjust(-TARGET_LEAP)}
        testID={`${testID}-down-leap`}
      />
      <StepButton
        label="Decrease the round length by one"
        glyph="close"
        disabled={target <= MIN_TASBIH_TARGET}
        onPress={() => onAdjust(-TARGET_STEP)}
        testID={`${testID}-down`}
      />
      <ModuleText
        token="cardTitle"
        numberOfLines={1}
        accessibilityLiveRegion="polite"
        testID={`${testID}-value`}
      >
        {String(target)}
      </ModuleText>
      <StepButton
        label="Increase the round length by one"
        glyph="add"
        disabled={target >= MAX_TASBIH_TARGET}
        onPress={() => onAdjust(TARGET_STEP)}
        testID={`${testID}-up`}
      />
      <StepButton
        label={`Increase the round length by ${TARGET_LEAP}`}
        glyph="chevron-forward"
        disabled={target >= MAX_TASBIH_TARGET}
        onPress={() => onAdjust(TARGET_LEAP)}
        testID={`${testID}-up-leap`}
      />
    </View>
  );
}

function StepButton({
  label,
  glyph,
  disabled,
  onPress,
  testID,
}: {
  readonly label: string;
  readonly glyph: 'add' | 'close' | 'chevron-back' | 'chevron-forward';
  readonly disabled: boolean;
  readonly onPress: () => void;
  readonly testID: string;
}) {
  const theme = useModuleTheme();
  const { dp } = useModuleMetrics();
  const size = dp(32);

  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      hitSlop={minimumHitSlop(size)}
      style={[
        styles.step,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          borderColor: disabled ? moduleNeutrals.border : theme.border,
          opacity: disabled ? 0.5 : 1,
        },
      ]}
      testID={testID}
    >
      <AppIcon
        name={glyph}
        size={dp(15)}
        color={disabled ? moduleNeutrals.textTertiary : theme.ink}
      />
    </PressableScale>
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
  flex: {
    flex: 1,
    minWidth: 0,
  },
  target: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  step: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    backgroundColor: moduleNeutrals.surface,
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
