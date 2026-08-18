import { StyleSheet, View } from 'react-native';

import { ModuleText } from '@features/modules/components';
import { moduleLayout, moduleNeutrals } from '@features/modules/module-tokens';
import { useModuleMetrics } from '@features/modules/use-module-metrics';

/**
 * A development-only audit panel, rendered inside the screen it is auditing.
 *
 * ── Why on the screen rather than in a console log ──────────────────────────
 * The two facts this module needs audited — where each Prayer value came from, and which pictogram
 * slots are still standing in with a vector — are both facts *about a rendering*. A console line
 * scrolls away and is read by whoever happened to have the terminal open; a panel under the content
 * is read by whoever is looking at the screenshot, which is the person the question is for.
 *
 * ── Why `__DEV__` is checked here and nowhere else ──────────────────────────
 * One guard, at the single render site, so there is no second place to forget. The functions that
 * produce the rows are pure and unguarded, which is what makes them testable — a `__DEV__` branch
 * inside a pure function is a branch no test can exercise honestly, because Jest sets `__DEV__`
 * true and a production bundle sets it false, and only one of those ever runs in CI.
 *
 * Metro strips `if (!__DEV__) return null` and everything it dominates from a release bundle, so a
 * production build renders nothing here and carries no strings from it.
 *
 * ── Why it looks like this ──────────────────────────────────────────────────
 * Deliberately unlike the product. A dashed amber border and a shouted heading, because the failure
 * mode for a diagnostic that resembles a card is that it ships — somebody screenshots it, nobody
 * questions it, and it reaches a store review looking like a feature.
 */

/** Amber. Not from the Faith palette, on purpose — see the note above. */
const AUDIT_INK = '#8A5A00';
const AUDIT_BORDER = '#D9A441';
const AUDIT_SURFACE = '#FFF8E7';

export type FaithDevAuditRow = {
  readonly key: string;
  /** What is being audited. */
  readonly label: string;
  /** What it resolves to. Never a user value — see `prayer-provenance.ts`. */
  readonly value: string;
  /** Renders the row as a problem rather than as an observation. */
  readonly flagged?: boolean;
};

export function FaithDevAudit({
  title,
  note,
  rows,
  testID,
}: {
  readonly title: string;
  /** One sentence saying what a reader should conclude. Optional; most panels want one. */
  readonly note?: string;
  readonly rows: readonly FaithDevAuditRow[];
  readonly testID: string;
}) {
  const { dp } = useModuleMetrics();

  // The one guard. A release bundle reaches this line and returns, and Metro removes the rest.
  if (!__DEV__) {
    return null;
  }

  return (
    <View
      style={[
        styles.panel,
        {
          borderRadius: dp(moduleLayout.cardRadius),
          padding: dp(moduleLayout.cardPadding),
          rowGap: dp(6),
        },
      ]}
      /*
        Reachable by a screen reader in development, because a developer using one should be able to
        read the audit too. It carries no user data, so there is nothing here to withhold.
      */
      accessibilityRole="summary"
      testID={testID}
    >
      <ModuleText token="caption" color={AUDIT_INK}>
        {`DEV AUDIT — ${title}`.toUpperCase()}
      </ModuleText>

      {note === undefined ? null : (
        <ModuleText token="caption" color={AUDIT_INK}>
          {note}
        </ModuleText>
      )}

      {rows.map((row) => (
        <View key={row.key} style={[styles.row, { columnGap: dp(8) }]}>
          <ModuleText token="caption" color={AUDIT_INK} style={styles.flex}>
            {/*
              `[!]` rather than a warning emoji. The module's rule is that no emoji is used as a
              glyph anywhere in it — an emoji is a font resource that renders differently on every
              device, and a diagnostic whose marker is invisible on one of them is worse than none.
            */}
            {row.flagged ? `[!] ${row.label}` : row.label}
          </ModuleText>
          <ModuleText
            token="caption"
            color={row.flagged ? AUDIT_INK : moduleNeutrals.textSecondary}
          >
            {row.value}
          </ModuleText>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: AUDIT_BORDER,
    backgroundColor: AUDIT_SURFACE,
  },
  row: {
    flexDirection: 'row',
    // Top rather than centre: a wrapped label at font scale 1.5 should not push its value's
    // baseline into the middle of two lines.
    alignItems: 'flex-start',
  },
  flex: {
    flex: 1,
    minWidth: 0,
  },
});
