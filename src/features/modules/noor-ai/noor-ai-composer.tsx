import { StyleSheet, TextInput, View } from 'react-native';

import { AppIcon, PressableScale } from '@ds/components';
import { fontFamilies } from '@ds/tokens';

import { ModuleStatusBanner } from '../components/module-status-banner';
import { ModuleText } from '../components/module-text';
import { useModuleTheme } from '../module-context';
import { moduleLayout, moduleNeutrals } from '../module-tokens';
import { useModuleMetrics } from '../use-module-metrics';
import { noorAIChatCopy } from './noor-ai-chat-copy';
import type { NoorAIDraftProblem } from './noor-ai-message-draft';

export type NoorAIComposerProps = {
  readonly value: string;
  readonly onChangeText: (value: string) => void;
  readonly onSubmit: () => void;
  /** Shown while a request is in flight. Abandons the wait; it does not un-send the question. */
  readonly onCancel: () => void;
  /** True from the moment a request is dispatched until its result arrives. */
  readonly pending: boolean;
  /** Content alone. `pending` is handled separately, so the two reasons never merge. */
  readonly canSubmit: boolean;
  /** Why the draft cannot be sent, once the field has been interacted with. Null while silent. */
  readonly problem: NoorAIDraftProblem | null;
  /** Changes the send hint after a failure, so "again" is not read as "resend the same request". */
  readonly afterFailure: boolean;
  readonly testID?: string;
};

/**
 * The Noor AI prompt composer.
 *
 * ── One question, one send ──────────────────────────────────────────────────
 * The submit control is disabled whenever the draft is unsendable *or* a request is already in
 * flight, and the screen holds a synchronous in-flight ref besides — two presses inside one frame
 * both run before React re-renders, so `disabled` alone would not stop the second. §I.1 mints a
 * fresh quota request id per handler execution, which makes a second invocation a second
 * reservation, a second provider attempt and a second charge; a double press must not buy one.
 *
 * ── Nothing here is remembered ──────────────────────────────────────────────
 * The draft is React state on the screen, and it is state only. It is not written to AsyncStorage,
 * secure storage, a Redux persistor, a log or an analytics event — none of which this file, this
 * feature or this application's Noor AI surface touches at all — and it dies with the component.
 * `autoCorrect` and `autoComplete` are turned off so the platform keyboard does not build its own
 * dictionary entry from what is typed here, which is the one place a prompt could persist without
 * this app persisting it.
 *
 * ── Accessibility ───────────────────────────────────────────────────────────
 * A visible label above the field, because a placeholder is not a label (spec §8). The field's
 * accessible name is its own, not the placeholder's. The send control is a labelled button with an
 * `accessibilityState.disabled` that matches what it actually does, and a hint that explains what
 * would enable it rather than what it would do — the same pattern `change-email-screen.tsx` adopted
 * after its device pass. The validation message is a `ModuleStatusBanner`, which carries a tone
 * icon and a polite live region, so a refusal is never communicated by colour or position alone.
 *
 * ── Multiline, and why the box grows ────────────────────────────────────────
 * §C.3.7 permits `\n`, and a question worth 1000 code points does not fit one line. The field is
 * multiline with a minimum height and no maximum, so long input wraps and grows rather than
 * scrolling inside a fixed box or clipping. The height is not a hard-coded pixel count in disguise:
 * `minHeight` is the floor, and content decides the rest.
 */
export function NoorAIComposer({
  value,
  onChangeText,
  onSubmit,
  onCancel,
  pending,
  canSubmit,
  problem,
  afterFailure,
  testID,
}: NoorAIComposerProps) {
  const theme = useModuleTheme();
  const { dp } = useModuleMetrics();

  const prefix = testID ?? 'noor-ai-composer';
  const sendEnabled = canSubmit && !pending;

  const hint = pending
    ? noorAIChatCopy.composer.submitHintPending
    : !canSubmit
      ? noorAIChatCopy.composer.submitHintDisabled
      : afterFailure
        ? noorAIChatCopy.composer.submitHintAfterFailure
        : noorAIChatCopy.composer.submitHintReady;

  const message =
    problem === null || problem === 'empty'
      ? null
      : problem === 'blank'
        ? noorAIChatCopy.draft.blank
        : problem === 'too-long'
          ? noorAIChatCopy.draft.tooLong
          : noorAIChatCopy.draft.unsupportedCharacters;

  return (
    <View style={{ rowGap: dp(7) }} testID={prefix}>
      <ModuleText token="cardTitle" nativeID={`${prefix}-label`} numberOfLines={1}>
        {noorAIChatCopy.composer.label}
      </ModuleText>

      <View
        style={[
          styles.field,
          {
            borderRadius: dp(moduleLayout.radiusSmall),
            borderColor: message === null ? moduleNeutrals.border : moduleNeutrals.error,
            paddingHorizontal: dp(12),
            paddingVertical: dp(8),
            minHeight: dp(84),
          },
        ]}
      >
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={noorAIChatCopy.composer.placeholder}
          placeholderTextColor={moduleNeutrals.textTertiary}
          multiline
          textAlignVertical="top"
          editable={!pending}
          // Off so the keyboard does not learn, store or suggest what was typed into this box.
          autoCorrect={false}
          autoComplete="off"
          spellCheck={false}
          accessibilityLabel={noorAIChatCopy.composer.accessibilityLabel}
          accessibilityHint={noorAIChatCopy.composer.accessibilityHint}
          accessibilityLabelledBy={`${prefix}-label`}
          accessibilityState={{ disabled: pending }}
          style={[styles.input, { fontSize: dp(13), lineHeight: dp(19) }]}
          testID={`${prefix}-input`}
        />
      </View>

      {message === null ? null : (
        <ModuleStatusBanner tone="error" message={message} testID={`${prefix}-problem`} />
      )}

      <View style={[styles.actions, { columnGap: dp(8) }]}>
        {pending ? (
          <>
            <View
              style={[styles.pending, { columnGap: dp(6) }]}
              accessible
              accessibilityLiveRegion="polite"
              accessibilityLabel={noorAIChatCopy.composer.pending}
              testID={`${prefix}-pending`}
            >
              <AppIcon name="sparkle" size={dp(15)} color={theme.ink} />
              <ModuleText token="caption" color={theme.ink} numberOfLines={1}>
                {noorAIChatCopy.composer.pending}
              </ModuleText>
            </View>

            <PressableScale
              onPress={onCancel}
              accessibilityRole="button"
              accessibilityLabel={noorAIChatCopy.composer.cancelAccessibilityLabel}
              style={[
                styles.secondary,
                {
                  minHeight: dp(moduleLayout.minTouchTarget),
                  borderRadius: dp(moduleLayout.radiusSmall),
                  paddingHorizontal: dp(16),
                  borderColor: moduleNeutrals.border,
                },
              ]}
              testID={`${prefix}-cancel`}
            >
              <ModuleText token="button" numberOfLines={1}>
                {noorAIChatCopy.composer.cancel}
              </ModuleText>
            </PressableScale>
          </>
        ) : (
          <View style={styles.flex} />
        )}

        <PressableScale
          onPress={onSubmit}
          disabled={!sendEnabled}
          accessibilityRole="button"
          accessibilityLabel={noorAIChatCopy.composer.submitAccessibilityLabel}
          accessibilityHint={hint}
          accessibilityState={{ disabled: !sendEnabled }}
          style={[
            styles.send,
            {
              minHeight: dp(moduleLayout.minTouchTarget),
              borderRadius: dp(moduleLayout.radiusSmall),
              paddingHorizontal: dp(18),
              columnGap: dp(7),
              backgroundColor: sendEnabled ? theme.fill : moduleNeutrals.skeleton,
            },
          ]}
          testID={`${prefix}-send`}
        >
          <AppIcon
            name="send"
            size={dp(16)}
            color={sendEnabled ? theme.onFill : moduleNeutrals.textTertiary}
          />
          <ModuleText
            token="button"
            color={sendEnabled ? theme.onFill : moduleNeutrals.textTertiary}
            numberOfLines={1}
          >
            {noorAIChatCopy.composer.submit}
          </ModuleText>
        </PressableScale>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    backgroundColor: moduleNeutrals.surface,
    borderWidth: 1,
  },
  input: {
    fontFamily: fontFamilies.regular,
    color: moduleNeutrals.textPrimary,
    // No fixed height: the box grows with the question rather than clipping it.
    padding: 0,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  flex: {
    flex: 1,
    minWidth: 0,
  },
  pending: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
  },
  secondary: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: moduleNeutrals.surface,
    borderWidth: 1,
  },
  send: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
