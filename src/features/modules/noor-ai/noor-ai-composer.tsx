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
import { minimumTouchTargetSize } from '@shared/utils/a11y';

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
 *
 * ── The height belongs to the input, not to the wrapper ─────────────────────
 * That floor is set on the `TextInput` itself, together with the text inset, so the input fills the
 * bordered box to its edge. It was previously set on the wrapper while the input kept its natural
 * single-line height, which left a box that looked like a text field with roughly its lower two
 * thirds inert — a tap there did not focus anything. AI-5's API 36 emulator pass found it by hitting
 * it. `noor-ai-composer-geometry.test.tsx` now asserts the arrangement from the rendered styles, so
 * moving the height back onto the wrapper fails a test rather than shipping.
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

      {/*
        The wrapper draws the border and nothing else — it deliberately carries no height.

        Its only child is the input, which carries both the minimum height and the text inset, so the
        field's visible box *is* the input and a tap anywhere inside it focuses the field. Putting a
        height here instead is what produced the dead lower two thirds that AI-5's emulator pass
        found; see `noorAIComposerInputHeight`.
      */}
      <View
        style={[
          styles.field,
          {
            borderRadius: dp(moduleLayout.radiusSmall),
            borderColor: message === null ? moduleNeutrals.border : moduleNeutrals.error,
          },
        ]}
        testID={`${prefix}-field`}
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
          style={[
            styles.input,
            {
              fontSize: dp(13),
              lineHeight: dp(19),
              // A floor, not a fixed height: long input still grows the field rather than clipping.
              minHeight: dp(moduleLayout.noorAIComposerInputHeight),
              paddingHorizontal: dp(12),
              paddingVertical: dp(8),
            },
          ]}
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
                  minHeight: minimumTouchTargetSize(),
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
              minHeight: minimumTouchTargetSize(),
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
    /**
     * Fills the wrapper, so the whole visible field is the touch target.
     *
     * The height and the text inset are applied at the call site from `moduleLayout`, and there is
     * deliberately no `height` here: a fixed one would clip a long question instead of growing.
     */
    alignSelf: 'stretch',
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
    // Stop and Send are the two controls in this row; neither may be compressed into an ellipsis.
    flexShrink: 0,
  },
  send: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    /**
     * Keeps its own width, so the label stays the whole word.
     *
     * The row is `[flexible spacer or progress line][Stop?][Send]`. As an ordinary flex child Send
     * carried `flexShrink: 1`, and at a large Android font scale the row ran short and compressed
     * it until `Send` rendered as `Se…` — caught on API 36 at a 1.30 font scale. The flexible
     * sibling gives up its room first now.
     */
    flexShrink: 0,
  },
});
