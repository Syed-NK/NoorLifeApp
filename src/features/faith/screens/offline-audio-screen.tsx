import { useCallback, useState } from 'react';
import { Modal, StyleSheet, View } from 'react-native';

import { PressableScale } from '@ds/components';
import { neutralColors, touchTarget } from '@ds/tokens';
import { ModuleText } from '@features/modules/components';
import { moduleLayout, moduleNeutrals } from '@features/modules/module-tokens';
import { useModuleTheme } from '@features/modules/module-context';
import { useModuleMetrics } from '@features/modules/use-module-metrics';

import { FaithRow, FaithRowGroup } from '../components/faith-list';
import { FaithScreen } from '../components/faith-screen';
import { formatBytes } from '../components/reader/quran-audio-player';
import type { OfflineSnapshot } from '../data/audio/offline-download.service';
import type { SizeEstimate, SizeSource } from '../data/audio/offline-estimate';
import { useOfflineRecitation } from '../di/offline-recitation-context';
import { faithNavKeys } from '../faith-routes';
import { SUDAIS_ATTRIBUTION } from '../data/quran-foundation/recitation-attribution';
import {
  ACTIVE_DOWNLOAD_STATES,
  COMPLETE_AYAH_COUNT,
  SURAH_COUNT,
  type OfflineDownloadState,
} from '../storage/faith-offline-recitation';

/**
 * Offline Qur'an audio — the one screen where recitation is downloaded, kept and removed.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── What this screen is for, and what it deliberately is not ───────────────
 * It is a **storage** screen. Everything on it is about several hundred megabytes on somebody's
 * phone: how large the download will be, whether there is room, whether it may run on cellular,
 * where it has got to, and how to take it off again. There is not one playback control on it, and
 * there is no playback control anywhere else that downloads — the two surfaces are separate because
 * the decisions are, and mixing them is how a download icon ended up on a docked player somebody
 * reaches for mid-recitation.
 *
 * ── The honesty rules this screen is written against ───────────────────────
 * **Nothing here fabricates a total.** Measured against the live feed, this is not a precaution: all
 * **6,236** rows of the active resource-3 generation carry `bytes: null`. Quran Foundation publishes
 * a duration per ayah and no file size at all, so before a download starts there is no honest byte
 * figure of any kind — not from the vendor, and not from this device, which has nothing to measure.
 *
 * So the screen leads with what *is* published — the total duration, "about 20 hours of recitation" —
 * and says plainly that the size is not known until the download runs. As files land, their byte
 * counts become measurements and the projection improves, and the wording says the numbers came from
 * the user's own downloads rather than from the publisher. A single confident megabyte figure before
 * any of that would be an invention with the typography of a measurement, and somebody decides
 * whether to spend half a gigabyte on the strength of it.
 *
 * **Nothing here says "gapless".** The word appears nowhere on this screen or in this feature. What
 * can be claimed is that playback is sourced from local files, which is a fact about the
 * architecture; how a transition sounds is a measurement, and it is reported in the verification
 * record rather than asserted in a caption.
 *
 * **Nothing here says audio expires.** It does not, for this reciter. The permission grants retention
 * beyond one week, and the seven-day obligation is a *check*, which is why the synchronisation row
 * says a check is due rather than that anything is about to be deleted.
 *
 * ── What may never appear on this screen ───────────────────────────────────
 * Any way to get a file out. No share, no export, no copy-to-Downloads, no path, no URL. The audio
 * lives in private application storage under licence condition C1, and a control that moved one
 * anywhere else would be the single most consequential line in this module.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export function OfflineAudioScreen() {
  return (
    <FaithScreen title="Offline audio" activeKey={faithNavKeys.more} testID="faith-offline-audio">
      <OfflineAudioBody />
    </FaithScreen>
  );
}

function OfflineAudioBody() {
  const { service, snapshot } = useOfflineRecitation();
  const { dp } = useModuleMetrics();
  /** Which destructive action is awaiting confirmation, or `null`. */
  const [confirming, setConfirming] = useState<'complete' | number | null>(null);

  const start = useCallback(() => {
    void service.start({ kind: 'complete' });
  }, [service]);

  const busy = snapshot.state === 'downloading' || snapshot.state === 'estimating';

  return (
    <View style={{ rowGap: dp(moduleLayout.cardGap) }} testID="faith-offline-audio-body">
      <StatusPanel snapshot={snapshot} />

      <FaithRowGroup title="Complete Qur’an" testID="faith-offline-audio-complete">
        <FaithRow
          title={completeTitle(snapshot.state)}
          subtitle={completeSubtitle(snapshot)}
          icon="download"
          {...(busy ? {} : { onPress: start })}
          accessibilityLabel={`${completeTitle(snapshot.state)}. ${completeSubtitle(snapshot)}`}
          testID="faith-offline-audio-start"
        />
        {snapshot.state === 'downloading' ? (
          <FaithRow
            title="Pause"
            subtitle="Stops the download. Verses already downloaded are kept."
            icon="pause"
            onPress={() => void service.pause()}
            testID="faith-offline-audio-pause"
          />
        ) : null}
        {isResumable(snapshot.state) ? (
          <FaithRow
            title="Resume"
            subtitle="Continues from where it stopped. Nothing already downloaded is fetched again."
            icon="play"
            onPress={() => void service.resume()}
            testID="faith-offline-audio-resume"
          />
        ) : null}
        {snapshot.failedAyat > 0 ? (
          <FaithRow
            title={`Retry ${snapshot.failedAyat} failed ${snapshot.failedAyat === 1 ? 'verse' : 'verses'}`}
            subtitle="Downloads only what is missing."
            icon="retry"
            iconColor={moduleNeutrals.warning}
            onPress={() => void service.retryFailed()}
            testID="faith-offline-audio-retry"
          />
        ) : null}
        {snapshot.playableAyat > 0 ? (
          <FaithRow
            title="Remove all downloaded audio"
            subtitle={`Deletes ${formatBytes(snapshot.downloadedBytes)} from this device.`}
            icon="delete"
            iconColor={moduleNeutrals.warning}
            onPress={() => setConfirming('complete')}
            testID="faith-offline-audio-remove-all"
          />
        ) : null}
      </FaithRowGroup>

      <FaithRowGroup title="Downloading" testID="faith-offline-audio-network">
        {[
          <FaithRow
            key="wifi"
            title="Wi-Fi only"
            subtitle={
              snapshot.wifiOnly
                ? 'Downloads wait until this device is on Wi-Fi.'
                : 'Downloads may use mobile data, which may cost money.'
            }
            icon="offline"
            trailing={
              <PressableScale
                onPress={() => void service.setWifiOnly(!snapshot.wifiOnly)}
                accessibilityRole="switch"
                accessibilityState={{ checked: snapshot.wifiOnly }}
                accessibilityLabel={`Wi-Fi only, ${snapshot.wifiOnly ? 'on' : 'off'}`}
                accessibilityHint={
                  snapshot.wifiOnly
                    ? 'Turns off Wi-Fi only, allowing downloads over mobile data'
                    : 'Turns on Wi-Fi only'
                }
                style={{ minHeight: dp(moduleLayout.minTouchTarget), justifyContent: 'center' }}
                testID="faith-offline-audio-wifi-toggle"
              >
                <ModuleText token="cardAction">{snapshot.wifiOnly ? 'On' : 'Off'}</ModuleText>
              </PressableScale>
            }
            trailingInteractive
            testID="faith-offline-audio-wifi"
          />,
        ]}
      </FaithRowGroup>

      <SurahPanel
        snapshot={snapshot}
        onRemoveSurah={(surah) => setConfirming(surah)}
        /*
          One run at a time — `execute` returns immediately when another is in flight — so while the
          download is estimating, transferring, verifying or removing, no retry can take effect on
          any row. The control says so rather than accepting a press that does nothing.
        */
        busy={ACTIVE_DOWNLOAD_STATES.includes(snapshot.state)}
        /*
          `retrySurah`, not `start({ selected: [surah] })`. `start` **records** the scope it is
          given, so retrying one surah would have rewritten the scope to that surah alone and
          quietly dropped everything else the user had asked for from the definition of
          "complete". That the old wiring was unreachable is the only reason it never did.
        */
        onRetrySurah={(surah) => void service.retrySurah(surah)}
      />

      <SyncPanel snapshot={snapshot} onCheck={() => void service.reconcile()} />

      {/*
        The attribution, verbatim.

        Rendered from the exported constant rather than typed here, so the string exists in exactly
        one place in the codebase and `recitation-attribution.test.ts` can pin it byte for byte. A
        licence condition met in three places and broken in a fourth is broken.
      */}
      <View
        style={{ paddingTop: dp(4) }}
        accessible
        accessibilityLabel={SUDAIS_ATTRIBUTION}
        testID="faith-offline-audio-attribution"
      >
        <ModuleText token="caption" numberOfLines={4}>
          {SUDAIS_ATTRIBUTION}
        </ModuleText>
      </View>

      {confirming === null ? null : (
        <ConfirmRemoval
          scope={confirming}
          bytes={snapshot.downloadedBytes}
          ayat={snapshot.playableAyat}
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            if (confirming === 'complete') {
              void service.removeAll();
            } else {
              void service.removeSurah(confirming);
            }
            setConfirming(null);
          }}
        />
      )}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// The status panel — counts, bytes, and an estimate that says how sure it is
// ─────────────────────────────────────────────────────────────────────────────

function StatusPanel({ snapshot }: { readonly snapshot: OfflineSnapshot }) {
  const { dp } = useModuleMetrics();
  const ayatLine = `${snapshot.playableAyat.toLocaleString()} of ${(snapshot.totalAyat || COMPLETE_AYAH_COUNT).toLocaleString()} verses`;
  const surahLine = `${snapshot.completeSurahs} of ${snapshot.totalSurahs || SURAH_COUNT} surahs complete`;

  return (
    <View
      style={{
        backgroundColor: moduleNeutrals.surface,
        borderRadius: dp(moduleLayout.cardRadius),
        padding: dp(16),
        rowGap: dp(6),
      }}
      accessible
      accessibilityLabel={`${describeDownloadState(snapshot.state)}. ${ayatLine}. ${surahLine}. ${formatBytes(snapshot.downloadedBytes)} downloaded. ${describeEstimate(snapshot.estimate)}`}
      testID="faith-offline-audio-status"
    >
      <ModuleText token="cardHeading">Abdur-Rahman as-Sudais</ModuleText>
      <ModuleText token="rowMeta">{describeDownloadState(snapshot.state)}</ModuleText>
      <ModuleText token="caption" testID="faith-offline-audio-ayat">
        {ayatLine}
      </ModuleText>
      <ModuleText token="caption" testID="faith-offline-audio-surahs">
        {surahLine}
      </ModuleText>
      <ModuleText token="caption" testID="faith-offline-audio-bytes">
        {`${formatBytes(snapshot.downloadedBytes)} downloaded`}
      </ModuleText>
      <ModuleText token="caption" numberOfLines={3} testID="faith-offline-audio-estimate">
        {describeEstimate(snapshot.estimate)}
      </ModuleText>
    </View>
  );
}

/**
 * The size estimate, in words that match how much is actually known.
 *
 * ── Three sentences, because there are three genuinely different situations ──
 * A range is shown as a range and never averaged into a single figure, because the midpoint of a
 * range is a number nobody measured. The coverage — how many verses the publisher stated a size for —
 * is given so the reader can judge the range rather than take it on trust, and `basis` says which
 * spread it came from, because a range derived from two fully-published surahs deserves less
 * confidence than one derived from a hundred.
 */
export function describeEstimate(estimate: SizeEstimate | null): string {
  if (estimate === null) {
    return 'Size will be worked out when you start a download.';
  }

  const duration = describeDuration(estimate.totalDurationSeconds);

  switch (estimate.kind) {
    case 'exact':
      return `${formatBytes(estimate.bytes)} for all ${estimate.totalAyat.toLocaleString()} verses${sourceSuffix(estimate.sizeSource)}.${duration}`;

    case 'partial':
      /*
        ── Why the coverage and the source are both stated ────────────────────
        A range is shown as a range and never averaged into a single figure: the midpoint of a range
        is a number nobody measured. The coverage lets the reader judge how much the range is worth,
        and the source stops the app crediting Quran Foundation with a projection this device made
        from its own downloads — which, on the live feed, is the only way any byte figure ever exists.
      */
      return `Estimated ${formatBytes(estimate.lowBytes)} to ${formatBytes(estimate.highBytes)} in total. ${formatBytes(estimate.knownBytes)} of that is measured from the ${estimate.knownAyat.toLocaleString()} of ${estimate.totalAyat.toLocaleString()} verses ${
        estimate.sizeSource === 'published' ? 'the publisher gave sizes for' : 'already downloaded'
      }; the rest is projected from ${
        estimate.basis === 'surah-means'
          ? 'how much the average verse size varies between surahs'
          : 'the smallest and largest verse so far'
      }.${duration}`;

    case 'unknown':
      /*
        ── The branch that actually runs, and why it leads with duration ──────
        Every one of the 6,236 live resource-3 rows carries `bytes: null`. So before a single file has
        landed there is no honest byte figure of any kind — not from the publisher, and not from this
        device, which has nothing to measure yet.

        Duration is different: the vendor publishes `durationSeconds` on every row, so "about 20 hours
        of recitation" is a stated fact rather than a derivation. It is also the only thing a user can
        actually use at this point. Converting it to bytes would need a bitrate nobody published, and
        that multiplication is exactly the invention this screen exists to refuse.
      */
      return `The publisher does not give file sizes, so the download size is not known until it starts — the amount downloaded is shown above as it grows.${duration}`;
  }
}

/** " About 20 hours of recitation." — or nothing at all when no duration was published. */
function describeDuration(totalSeconds: number | null): string {
  if (totalSeconds === null || totalSeconds <= 0) {
    return '';
  }
  const hours = Math.round(totalSeconds / 3600);
  if (hours >= 2) {
    return ` About ${hours} hours of recitation.`;
  }
  const minutes = Math.max(1, Math.round(totalSeconds / 60));
  return ` About ${minutes} ${minutes === 1 ? 'minute' : 'minutes'} of recitation.`;
}

/** Names the source only where it could otherwise be misread as the publisher's figure. */
function sourceSuffix(source: SizeSource): string {
  switch (source) {
    case 'published':
      return ', as published';
    case 'measured':
      return ', measured from the files on this device';
    case 'mixed':
      return ', partly published and partly measured from the files on this device';
  }
}

/** Each whole-download state, in one sentence that says what is true and what to expect. */
export function describeDownloadState(state: OfflineDownloadState): string {
  switch (state) {
    case 'not-downloaded':
      return 'Not downloaded';
    case 'estimating':
      return 'Working out how large this will be';
    case 'ready':
      return 'Ready to download';
    case 'downloading':
      return 'Downloading';
    case 'paused':
      return 'Paused';
    case 'waiting-for-wifi':
      return 'Waiting for Wi-Fi';
    case 'waiting-for-connection':
      return 'Waiting for a connection';
    case 'insufficient-storage':
      return 'Not enough free space. Verses already downloaded have been kept.';
    case 'partially-downloaded':
      return 'Partly downloaded';
    case 'verifying':
      return 'Checking downloaded files';
    case 'complete':
      return 'Downloaded and available offline';
    case 'update-required':
      return 'An update is available. Current audio still plays until it is replaced.';
    case 'removing':
      return 'Removing';
    case 'failed':
      return 'The last download did not finish';
  }
}

function completeTitle(state: OfflineDownloadState): string {
  switch (state) {
    case 'complete':
      return 'Downloaded';
    case 'downloading':
    case 'estimating':
      return 'Downloading…';
    case 'update-required':
      return 'Download the update';
    default:
      return 'Download the complete Qur’an';
  }
}

function completeSubtitle(snapshot: OfflineSnapshot): string {
  if (snapshot.state === 'complete') {
    return `All ${snapshot.playableAyat.toLocaleString()} verses are on this device and play without a connection.`;
  }
  if (snapshot.state === 'downloading') {
    return `${snapshot.playableAyat.toLocaleString()} of ${(snapshot.totalAyat || COMPLETE_AYAH_COUNT).toLocaleString()} verses • ${formatBytes(snapshot.downloadedBytes)}`;
  }
  return 'Downloads every verse so the reader can play without a connection. You choose when this runs.';
}

function isResumable(state: OfflineDownloadState): boolean {
  return (
    state === 'paused' ||
    state === 'waiting-for-wifi' ||
    state === 'waiting-for-connection' ||
    state === 'partially-downloaded' ||
    state === 'insufficient-storage' ||
    state === 'failed' ||
    state === 'update-required'
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-surah management
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Per-surah rows, listing only what is actually on the device.
 *
 * ── Why this is not 114 rows with 114 download buttons ─────────────────────
 * Because a list of every surah with a control on each is a list in which the destructive action for
 * a surah somebody spent a journey downloading sits one row away from a download control for one they
 * have never opened. What a user needs here is "what is on my phone, and how do I take one off", so
 * the rows are what is present. Downloading a specific surah is reached from the reader, where the
 * user is already looking at the surah in question.
 */
function SurahPanel({
  snapshot,
  onRemoveSurah,
  onRetrySurah,
  busy,
}: {
  readonly snapshot: OfflineSnapshot;
  readonly onRemoveSurah: (surah: number) => void;
  readonly onRetrySurah: (surah: number) => void;
  /** True while a run is in flight, in which case no retry can take effect. */
  readonly busy: boolean;
}) {
  /*
    Read straight from the snapshot. This used to be a `useMemo` over 114 surahs keyed on
    `playableAyat`, and on a release device it went stale: the header read "789 verses, 5 surahs
    complete" while this list showed surah 4 with 132 verses and no surah 5 at all. Two counters over
    one manifest disagreeing is the defect class this feature exists to eliminate, and a memo between
    the data and the screen was the only thing that could reintroduce it.
  */
  const theme = useModuleTheme();
  const surahs = snapshot.downloadedSurahs;

  if (surahs.length === 0) {
    return null;
  }

  return (
    <FaithRowGroup
      title={`Downloaded surahs (${surahs.length})`}
      testID="faith-offline-audio-surahs-group"
    >
      {surahs.map((entry) => {
        const complete = entry.complete;
        /*
          ── Why Retry is a control here and not a press on the row ────────────
          This row used to pass `onPress` alongside `trailingInteractive`, and `FaithRow` ignores
          `onPress` in that combination — deliberately, because a row press that also drove the
          control beside it would put two handlers on one gesture. So the handler had never run: the
          row reported `clickable=false` to the platform, and only a device dump showed it.
          `FaithRowProps` is now a union that makes the pair a compile error.

          The replacement is a second control in the same trailing area: two independently focusable
          nodes, each with its own label, hint and target, sharing no gesture. Remove keeps its own
          confirmation and is unchanged.
        */
        return (
          <FaithRow
            key={entry.surah}
            title={`Surah ${entry.surah}`}
            subtitle={
              complete
                ? `All ${entry.playable} verses`
                : `${entry.playable} of ${entry.total ?? '?'} verses — plays until the first missing verse`
            }
            icon={complete ? 'download' : 'retry'}
            {...(complete ? {} : { iconColor: moduleNeutrals.warning })}
            trailing={
              <View style={styles.rowActions}>
                {complete ? null : (
                  <PressableScale
                    onPress={() => onRetrySurah(entry.surah)}
                    disabled={busy}
                    accessibilityRole="button"
                    accessibilityLabel={`Retry surah ${entry.surah}, ${entry.playable} of ${
                      entry.total ?? '?'
                    } verses downloaded`}
                    /*
                      The hint says what the service actually does. A run covers the recorded scope,
                      so this resumes the download and fetches what is still missing — it does not
                      fetch this surah alone, and claiming otherwise would be a promise the executor
                      does not keep. See `retrySurah` for why that is not worked around here.
                    */
                    accessibilityHint={
                      busy
                        ? 'Unavailable while a download is running'
                        : 'Resumes the download and fetches the verses still missing. Nothing already downloaded is fetched again.'
                    }
                    accessibilityState={{ disabled: busy }}
                    style={styles.rowAction}
                    testID={`faith-offline-audio-retry-surah-${entry.surah}`}
                  >
                    <ModuleText
                      token="cardAction"
                      color={busy ? moduleNeutrals.textTertiary : theme.ink}
                      maxFontSizeMultiplier={1.4}
                    >
                      Retry
                    </ModuleText>
                  </PressableScale>
                )}
                <PressableScale
                  onPress={() => onRemoveSurah(entry.surah)}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove downloaded surah ${entry.surah}, ${entry.playable} verses`}
                  accessibilityHint="Deletes the audio from this device"
                  style={styles.rowAction}
                  testID={`faith-offline-audio-remove-surah-${entry.surah}`}
                >
                  <ModuleText
                    token="cardAction"
                    color={moduleNeutrals.warning}
                    maxFontSizeMultiplier={1.4}
                  >
                    Remove
                  </ModuleText>
                </PressableScale>
              </View>
            }
            /*
              The row carries its own control, so the container must not merge it — the same rule the
              prayer switches are governed by. See `FaithRowProps.trailingInteractive`.
            */
            trailingInteractive
            testID={`faith-offline-audio-surah-${entry.surah}`}
          />
        );
      })}
    </FaithRowGroup>
  );
}

const styles = StyleSheet.create({
  /*
    Retry and Remove side by side in the row’s trailing area. A row gap as well as a column gap
    because at a large OS text size the two labels wrap onto separate lines, and two 44 dp targets
    touching edge to edge is how a mis-tap removes audio somebody meant to repair.
  */
  rowActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
    columnGap: 14,
    rowGap: 4,
  },
  /*
    `touchTarget.minimum` unscaled, deliberately. `dp()` scales by screen width, and a floor that
    shrinks on a narrower phone is not a floor — measured at 43 dp on a 384 dp device when it was
    wrapped, which is the defect `205659b` fixed for the prayer sheet.
  */
  rowAction: {
    minHeight: touchTarget.minimum,
    minWidth: touchTarget.minimum,
    justifyContent: 'center',
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Synchronisation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * When the download last agreed with the publisher, and whether a check is owed.
 *
 * ── Why "due" never means "about to be deleted" ────────────────────────────
 * Licence condition C7 obliges a **connected** device to check at least every seven connected days.
 * Passing that window means a check is owed. It does not mean anything may be removed, and a device
 * that has been offline for a month keeps every verse it holds — that is exactly the user condition
 * C9 protects. So this panel says a check is due and offers to run one, and there is no copy anywhere
 * on this screen that threatens deletion by elapsed time.
 */
function SyncPanel({
  snapshot,
  onCheck,
}: {
  readonly snapshot: OfflineSnapshot;
  readonly onCheck: () => void;
}) {
  /**
   * The clock, read once when this panel mounts.
   *
   * ── Why it is not read during render ────────────────────────────────────────
   * `Date.now()` in a render body makes the component non-idempotent: two renders of the same state
   * produce different output, which is exactly what React's purity rule forbids and what makes a
   * concurrent re-render able to change a caption nothing asked to change.
   *
   * Once at mount is also the right *product* answer here. The value being rendered is "a check is
   * due" or "checked three days ago" — a figure in days, over a seven-day window. Nothing about it
   * can change while somebody is looking at this screen, and re-reading the clock per render would
   * spend a correctness hazard on a number that cannot move.
   */
  const [now] = useState(() => Date.now());
  const due = isCheckDue(snapshot.reconciledAt, now);
  const summary = describeSync(snapshot.reconciledAt, snapshot.updateRequiredAyat, now);

  return (
    <FaithRowGroup title="Keeping up to date" testID="faith-offline-audio-sync">
      {[
        <FaithRow
          key="check"
          title="Check for updates"
          subtitle={summary}
          icon="retry"
          {...(due ? { iconColor: moduleNeutrals.warning } : {})}
          onPress={onCheck}
          accessibilityLabel={`Check for updates. ${summary}`}
          testID="faith-offline-audio-check"
        />,
      ]}
    </FaithRowGroup>
  );
}

/** Seven days, the window licence condition C7 sets. A check obligation, never a deletion rule. */
export const SYNC_CHECK_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

export function isCheckDue(reconciledAt: number | null, now: number): boolean {
  if (reconciledAt === null) {
    return true;
  }
  const elapsed = now - reconciledAt;
  /* A clock that moved backwards is treated as due rather than fresh; failing toward a check. */
  return elapsed < 0 || elapsed >= SYNC_CHECK_INTERVAL_MS;
}

export function describeSync(
  reconciledAt: number | null,
  updateRequiredAyat: number,
  now: number,
): string {
  if (updateRequiredAyat > 0) {
    return `${updateRequiredAyat} ${updateRequiredAyat === 1 ? 'verse has' : 'verses have'} an update available. The audio you have keeps playing until the replacement is downloaded.`;
  }
  if (reconciledAt === null) {
    return 'Not checked yet. Downloads are checked against the publisher when you are connected.';
  }
  const days = Math.max(0, Math.floor((now - reconciledAt) / (24 * 60 * 60 * 1000)));
  if (!isCheckDue(reconciledAt, now)) {
    return days === 0
      ? 'Checked today. Everything is up to date.'
      : `Checked ${days} ${days === 1 ? 'day' : 'days'} ago. Everything is up to date.`;
  }
  return `A check is due — last checked ${days} ${days === 1 ? 'day' : 'days'} ago. The audio on this device still plays.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Confirmation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The confirmation before anything is deleted.
 *
 * ── Why removal of the complete Qur'an cannot be a single tap ──────────────
 * It can represent hours of downloading over a connection the user may not have again soon, and the
 * action is not undoable in any sense that helps them at the time. Cancel is listed first and is the
 * safe default. A per-surah removal is confirmed too — the brief requires it only for the complete
 * download, but the two controls sit in the same screen and giving one a dialog and the other none
 * teaches the hand that Remove is instant.
 */
function ConfirmRemoval({
  scope,
  bytes,
  ayat,
  onCancel,
  onConfirm,
}: {
  readonly scope: 'complete' | number;
  readonly bytes: number;
  readonly ayat: number;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}) {
  const { dp } = useModuleMetrics();
  const complete = scope === 'complete';
  const title = complete ? 'Remove all downloaded audio?' : `Remove surah ${scope}?`;
  const body = complete
    ? `This deletes ${formatBytes(bytes)} — ${ayat.toLocaleString()} verses of Abdur-Rahman as-Sudais's recitation — from this device. The reader will not be able to play until you download again.`
    : `This deletes surah ${scope}'s audio from this device. Other downloaded surahs are not affected.`;

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={onCancel}
      testID="faith-offline-audio-confirm"
    >
      <View
        style={{
          flex: 1,
          justifyContent: 'center',
          padding: dp(moduleLayout.pagePadding),
          /* The locked scrim, the same dim the verse action sheet draws over the reader. */
          backgroundColor: neutralColors.scrim,
        }}
      >
        <View
          style={{
            backgroundColor: moduleNeutrals.surface,
            borderRadius: dp(moduleLayout.cardRadius),
            padding: dp(18),
            rowGap: dp(12),
          }}
          accessibilityViewIsModal
        >
          <ModuleText token="cardHeading">{title}</ModuleText>
          <ModuleText token="rowMeta" numberOfLines={6}>
            {body}
          </ModuleText>
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', columnGap: dp(16) }}>
            <PressableScale
              onPress={onCancel}
              accessibilityRole="button"
              accessibilityLabel="Keep the downloaded audio"
              style={{ minHeight: dp(moduleLayout.minTouchTarget), justifyContent: 'center' }}
              testID="faith-offline-audio-confirm-cancel"
            >
              <ModuleText token="cardAction">Cancel</ModuleText>
            </PressableScale>
            <PressableScale
              onPress={onConfirm}
              accessibilityRole="button"
              accessibilityLabel={title}
              style={{ minHeight: dp(moduleLayout.minTouchTarget), justifyContent: 'center' }}
              testID="faith-offline-audio-confirm-remove"
            >
              <ModuleText token="cardAction" color={moduleNeutrals.warning}>
                Remove
              </ModuleText>
            </PressableScale>
          </View>
        </View>
      </View>
    </Modal>
  );
}
