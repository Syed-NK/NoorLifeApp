import { StyleSheet, View } from 'react-native';

import { AppIcon, Pill } from '@ds/components';
import type { AIRequestContext } from '@shared/permissions/ai-scope';

import { ModuleCard } from '../components/module-card';
import { ModuleText } from '../components/module-text';
import { useModuleTheme } from '../module-context';
import { moduleLayout, moduleNeutrals } from '../module-tokens';
import { useModuleMetrics } from '../use-module-metrics';
import { noorAIChatCopy } from './noor-ai-chat-copy';

export type NoorAIScopeNoteProps = {
  /**
   * The very context that will be passed to `ask`.
   *
   * Passed in rather than recomputed, so what the user is shown and what the request carries are
   * the same object. A scope display that recomputed its own answer is the most dangerous kind,
   * because it is the one the user believes — `ai-effective-scope.ts` makes the same argument.
   */
  readonly context: AIRequestContext;
  /** True when the plan limits Noor AI to NoorLife itself rather than to the paid modules. */
  readonly limited: boolean;
  readonly testID?: string;
};

/**
 * The scope block above the composer.
 *
 * §06 requires the scope to be shown near the composer and requires the app to "display which
 * modules are being accessed". Both are answered here, and the honest answer to the second is
 * **none**:
 *
 *   • `grantedModules` is empty for every user, because there is no grant store —
 *     `AI_GRANT_EDITING_AVAILABLE` is `false` and AI-6 owns the server-side one.
 *   • `NoorAIAnswer` has no `accessed_modules` field at all. §C.4 sends an empty array and the
 *     adapter validates it is empty and then drops it, so there is no value a screen could render
 *     even if it wanted to.
 *   • The Edge Function performs no retrieval (§A.1, §F.4), so nothing is read on the server side
 *     either.
 *
 * "No module access" is therefore a fact about this build, not a placeholder waiting for data, and
 * it is rendered as a state rather than as an absence.
 *
 * ── What this is not ────────────────────────────────────────────────────────
 * It is explanatory UI. It sends nothing: `permittedModules` and `grantedModules` are §C.6's
 * forbidden body fields — "a client-sent grant is a self-issued permission" — and the adapter
 * serialises nothing from the context except an allow-listed `surface`. The `authority` sentence
 * says as much to the user, because a scope panel that implied the device had authorised something
 * would be claiming a boundary it does not hold (§E.2).
 */
export function NoorAIScopeNote({ context, limited, testID }: NoorAIScopeNoteProps) {
  const theme = useModuleTheme();
  const { dp } = useModuleMetrics();

  const grantedCount = context.grantedModules.length;

  return (
    <ModuleCard tinted accentBorder testID={testID}>
      <View style={{ rowGap: dp(7) }}>
        {/*
          Wraps, so the scope badge is never squeezed into an ellipsis.

          The badge holds its own width (`Pill` sets `flexShrink: 0`) because a truncated scope
          badge misstates the scope. At a large Android font scale the heading beside it grows and
          wraps to two lines, and if the two no longer fit on one row the badge drops onto its own
          row instead of shrinking. Verified at a 1.30 font scale on API 36.
        */}
        <View style={[styles.headingRow, { columnGap: dp(8), rowGap: dp(6) }]}>
          <ModuleText token="cardHeading" numberOfLines={2} style={styles.flex}>
            {noorAIChatCopy.scope.heading}
          </ModuleText>
          <Pill
            label={noorAIChatCopy.scope.pill}
            icon="shield"
            backgroundColor={moduleNeutrals.surface}
            textColor={theme.ink}
            accessibilityLabel={`Scope. ${noorAIChatCopy.scope.pill}`}
            testID={`${testID ?? 'noor-ai-scope'}-pill`}
          />
        </View>

        <ModuleText token="body" testID={`${testID ?? 'noor-ai-scope'}-subjects`}>
          {limited ? noorAIChatCopy.scope.limitedSubjects : noorAIChatCopy.scope.fullSubjects}
        </ModuleText>

        {/*
          The module-access state.

          Rendered with a lock glyph as well as a heading, so the state is never carried by
          position or colour alone, and announced as one accessible unit so a screen reader hears
          "No module access" together with what it means rather than as an orphaned label.

          The `grantedCount > 0` branch is unreachable today and is deliberately not written as a
          list of module names: showing which modules a user granted would be the first place
          private module data could appear on this screen, and AI-6 owns that display along with
          the store that would make it non-empty.
        */}
        <View
          style={[
            styles.access,
            {
              borderRadius: dp(moduleLayout.radiusSmall),
              paddingVertical: dp(8),
              paddingHorizontal: dp(9),
              columnGap: dp(8),
            },
          ]}
          accessible
          accessibilityLabel={`${noorAIChatCopy.scope.noModuleAccess}. ${noorAIChatCopy.scope.noModuleAccessDetail}`}
          testID={`${testID ?? 'noor-ai-scope'}-module-access`}
        >
          <AppIcon name="lock" size={dp(16)} color={moduleNeutrals.textSecondary} />
          <View style={[styles.flex, { rowGap: dp(2) }]}>
            <ModuleText token="cardTitle" numberOfLines={1}>
              {noorAIChatCopy.scope.noModuleAccess}
            </ModuleText>
            <ModuleText token="caption">{noorAIChatCopy.scope.noModuleAccessDetail}</ModuleText>
          </View>
        </View>

        <ModuleText token="caption" testID={`${testID ?? 'noor-ai-scope'}-authority`}>
          {noorAIChatCopy.scope.authority}
        </ModuleText>

        <ModuleText token="caption" testID={`${testID ?? 'noor-ai-scope'}-not-an-authority`}>
          {noorAIChatCopy.scope.notAnAuthority}
        </ModuleText>

        {/* Unreachable while there is no grant store; asserted unreachable by test. */}
        {grantedCount === 0 ? null : (
          <ModuleText token="caption" testID={`${testID ?? 'noor-ai-scope'}-granted-count`}>
            {`Modules you have granted: ${String(grantedCount)}.`}
          </ModuleText>
        )}
      </View>
    </ModuleCard>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  /** The heading-and-badge row. Wraps rather than compressing the badge. */
  headingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  flex: {
    flex: 1,
    minWidth: 0,
  },
  access: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: moduleNeutrals.surface,
    borderWidth: 1,
    borderColor: moduleNeutrals.border,
  },
});
