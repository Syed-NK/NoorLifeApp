import { useCallback, useEffect, useState } from 'react';
import { Modal, View } from 'react-native';

import { PressableScale } from '@ds/components';
import { ModuleText } from '@features/modules/components';
import { moduleLayout, moduleNeutrals } from '@features/modules/module-tokens';
import { useModuleMetrics } from '@features/modules/use-module-metrics';

import {
  deferLegacyDecision,
  importLegacyQuarantine,
  readLegacyDecision,
  readLegacyQuarantineSummary,
  removeLegacyQuarantine,
  type LegacyQuarantineSummary,
} from '../storage/faith-legacy-quarantine';
import { getActiveFaithScope, subscribeToFaithScope } from '../storage/faith-user-scope';

/**
 * The one-time question about Faith data that was on this device before accounts were partitioned.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Why this is a question and not a migration ─────────────────────────────
 * The data is real and somebody made it, and nothing on the device records who. Moving it into
 * whichever account signs in next is right on almost every phone and is a privacy breach on a
 * shared or resold one. The sweep has already put it out of reach; this asks the only person who
 * can actually answer.
 *
 * ── What this screen may not say ───────────────────────────────────────────
 * **Not one value.** No bookmark, no note, no counter label, no place name, no count of anything
 * except how many *kinds* of data were found. Showing a preview to help somebody decide whether the
 * data is theirs would disclose it to somebody who may not be its owner — the preview is the breach
 * it is trying to prevent. "Four kinds of Faith data" and a date is the most that can honestly be
 * offered, and it is deliberately not enough to identify anybody.
 *
 * ── Why all three answers are equally weighted ─────────────────────────────
 * No default button, no colour that reads as recommended, no "recommended" label. The app does not
 * know whose data it is, so it is in no position to suggest what should happen to it. Only removal
 * gets a second step, because only removal cannot be undone.
 * ═══════════════════════════════════════════════════════════════════════════
 */

type Stage = 'asking' | 'confirming-remove' | 'working' | 'failed';

export function LegacyDataPrompt() {
  const { dp } = useModuleMetrics();
  const [summary, setSummary] = useState<LegacyQuarantineSummary | null>(null);
  const [stage, setStage] = useState<Stage>('asking');

  /**
   * Re-asks whenever the account changes, and only ever for a signed-in one.
   *
   * ── Why the scope subscription rather than a mount-only read ───────────────
   * The decision belongs to an account. User A choosing "decide later" must not answer on user B's
   * behalf, so a switch has to reopen the question — and a Faith screen can stay mounted across one.
   * Reading only on mount would leave B looking at A's dismissed prompt, or at nothing.
   */
  useEffect(() => {
    let cancelled = false;
    const run = (): void => {
      void (async () => {
        const scope = getActiveFaithScope();
        if (scope === null) {
          if (!cancelled) setSummary(null);
          return;
        }
        const decided = await readLegacyDecision();
        const found = decided === null ? await readLegacyQuarantineSummary() : null;
        if (cancelled) {
          return;
        }
        setSummary(found);
        if (found !== null) {
          setStage('asking');
        }
      })();
    };
    run();
    /*
      The sweep runs in an effect one provider up and may finish after this one mounts, so a first
      launch would otherwise find nothing and never ask. A scope change re-runs this, and the first
      resolution of a launch *is* a scope change, which covers the ordinary case.
    */
    const unsubscribe = subscribeToFaithScope(run);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const onImport = useCallback(() => {
    setStage('working');
    void (async () => {
      const outcome = await importLegacyQuarantine();
      if (outcome.kind === 'imported' || outcome.kind === 'nothing-to-import') {
        setSummary(null);
        return;
      }
      /*
        The quarantine is still there and still intact — `importLegacyQuarantine` deletes it only
        after reading back what it wrote. Saying so, and leaving the question open, is the honest
        outcome; reporting success would tell somebody their data was restored when it was not.
      */
      setStage('failed');
    })();
  }, []);

  const onRemove = useCallback(() => {
    setStage('working');
    void (async () => {
      const removed = await removeLegacyQuarantine();
      if (removed) {
        setSummary(null);
        return;
      }
      setStage('failed');
    })();
  }, []);

  const onLater = useCallback(() => {
    void (async () => {
      await deferLegacyDecision();
      /*
        Dismissed for now, and nothing is written. The bundle stays quarantined and invisible, and
        the question returns next launch — which is what "later" has to mean if it is not to become
        a silent third answer.
      */
      setSummary(null);
    })();
  }, []);

  if (summary === null) {
    return null;
  }

  const found = new Date(summary.capturedAt).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  return (
    <Modal
      transparent
      animationType="fade"
      visible
      onRequestClose={onLater}
      testID="faith-legacy-data-prompt"
    >
      <View
        style={{
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.45)',
          justifyContent: 'center',
          padding: dp(moduleLayout.pagePadding),
        }}
      >
        <View
          style={{
            backgroundColor: moduleNeutrals.surface,
            borderRadius: dp(moduleLayout.cardRadius),
            padding: dp(moduleLayout.pagePadding),
            gap: dp(12),
          }}
        >
          <ModuleText token="cardHeading" testID="faith-legacy-data-title">
            Faith data already on this device
          </ModuleText>

          {stage === 'confirming-remove' ? (
            <>
              <ModuleText token="caption">
                This permanently deletes it. It is not backed up anywhere and cannot be recovered.
              </ModuleText>
              <PressableScale
                onPress={onRemove}
                accessibilityRole="button"
                accessibilityLabel="Permanently remove existing Faith data"
                testID="faith-legacy-data-remove-confirm"
              >
                <ModuleText token="cardHeading">Remove permanently</ModuleText>
              </PressableScale>
              <PressableScale
                onPress={() => setStage('asking')}
                accessibilityRole="button"
                accessibilityLabel="Go back without removing"
                testID="faith-legacy-data-remove-cancel"
              >
                <ModuleText token="caption">Go back</ModuleText>
              </PressableScale>
            </>
          ) : (
            <>
              <ModuleText token="caption">
                {`${summary.categoryCount} ${summary.categoryCount === 1 ? 'kind' : 'kinds'} of Faith data were found on this device on ${found}, from before NoorLife kept each account's data separately. NoorLife cannot tell whose it is, so it has not been opened.`}
              </ModuleText>
              <ModuleText token="caption">Import it only if it is yours.</ModuleText>

              {stage === 'failed' ? (
                <ModuleText token="caption" testID="faith-legacy-data-error">
                  That did not complete. Nothing was changed, and the data is still here.
                </ModuleText>
              ) : null}

              <PressableScale
                onPress={onImport}
                disabled={stage === 'working'}
                accessibilityRole="button"
                accessibilityLabel="Import existing Faith data from this device"
                testID="faith-legacy-data-import"
              >
                <ModuleText token="cardHeading">Import existing Faith data</ModuleText>
              </PressableScale>
              <PressableScale
                onPress={() => setStage('confirming-remove')}
                disabled={stage === 'working'}
                accessibilityRole="button"
                accessibilityLabel="Remove existing Faith data"
                testID="faith-legacy-data-remove"
              >
                <ModuleText token="cardHeading">Remove existing Faith data</ModuleText>
              </PressableScale>
              <PressableScale
                onPress={onLater}
                disabled={stage === 'working'}
                accessibilityRole="button"
                accessibilityLabel="Decide later"
                testID="faith-legacy-data-later"
              >
                <ModuleText token="caption">Decide later</ModuleText>
              </PressableScale>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}
