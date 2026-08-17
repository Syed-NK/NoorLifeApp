import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Switch, View } from 'react-native';

import { AppIcon } from '@ds/components';
import { ModuleStatusBanner } from '@features/modules/components';
import { useModuleTheme } from '@features/modules/module-context';
import { moduleLayout } from '@features/modules/module-tokens';
import { useModuleMetrics } from '@features/modules/use-module-metrics';

import { FaithRow, FaithRowGroup } from '../components/faith-list';
import { FaithScreen, FaithSuccessBanner } from '../components/faith-screen';
import { formatBytes } from '../components/reader/quran-audio-player';
import { hasData } from '../data/faith-result';
import type { CalculationMethod } from '../data/prayer-times.repository';

import { useFaithRepositories } from '../di/faith-repository-context';
import { faithNavKeys, faithRoutes } from '../faith-routes';
import { DEFAULT_RECITER_NAME, type FaithPreferences } from '../storage/faith-preferences';
import { useFaithPreferences } from '../hooks/use-faith-preferences';
import { useOfflineRecitation } from '../di/offline-recitation-context';
import type { OfflineSnapshot } from '../data/audio/offline-download.service';
import { useFaithResource } from '../hooks/use-faith-resource';
import { usePrayerNotifications } from '../hooks/use-prayer-notifications';
import { useTranslationPreference } from '../hooks/use-translation-preference';

const METHODS: readonly { readonly id: CalculationMethod; readonly label: string }[] = [
  { id: 'muslim-world-league', label: 'Muslim World League' },
  { id: 'umm-al-qura', label: 'Umm al-Qura' },
  { id: 'egyptian', label: 'Egyptian General Authority' },
  { id: 'karachi', label: 'University of Karachi' },
  { id: 'isna', label: 'ISNA' },
  { id: 'moonsighting-committee', label: 'Moonsighting Committee' },
];

/**
 * Translation, reciter and calculation preferences.
 *
 * Every choice here persists immediately and is read by the reader, the Daily Ayah, the
 * search screen and the prayer times — so this is where the phase's "selected translation
 * and reciter preferences" requirement is actually satisfied end to end, not just stored.
 */
export function PreferencesScreen() {
  return (
    <FaithScreen title="Faith preferences" activeKey={faithNavKeys.more} testID="faith-preferences">
      <PreferencesBody />
    </FaithScreen>
  );
}

/** Split out so it renders inside the scaffold's `ModuleProvider`. */
function PreferencesBody() {
  const router = useRouter();
  const theme = useModuleTheme();
  const { dp } = useModuleMetrics();
  const { quran } = useFaithRepositories();
  const { preferences, update } = useFaithPreferences();
  const { translation, status } = useTranslationPreference();
  const [saved, setSaved] = useState<string | null>(null);
  /*
    `false` — this screen reschedules only *after* it changes a calculation input, exactly as the
    Prayer location screen does. Reconciling on mount would spend one prayer-time calculation per day
    of the horizon to render a list of radio rows.
  */
  const notifications = usePrayerNotifications(false);
  const offline = useOfflineRecitation();

  /**
   * The reciter's name for the summary row.
   *
   * Its own small resource rather than part of a combined edition fetch: this screen no longer
   * renders either catalogue, and pulling several hundred rows to render one name would be the
   * defect this change exists to remove, in miniature. A catalogue failure costs the name and
   * nothing else — the row still opens the selector.
   */
  const reciters = useFaithResource(
    'faith.preferences.reciter-name',
    useCallback(() => quran.availableReciters(), [quran]),
  );
  const reciterName =
    reciters.status === 'settled' && hasData(reciters.result)
      ? (reciters.result.data.find((entry) => entry.id === preferences.reciterId)?.name ?? null)
      : null;

  /**
   * Persist a preference, then rebuild the alert schedule it invalidates.
   *
   * ── The gap this closes ─────────────────────────────────────────────────────
   * The calculation method and the Asr convention are two of the three inputs that decide *when*
   * every prayer is — the location being the third. Changing one here moved the times on the Prayer
   * screen immediately, because those resources key on the preference, and left the already-scheduled
   * notifications alone. The alarms then fired at the previous method's instants: not by minutes in
   * the worst case, and silently, because nothing on screen claims a notification time.
   *
   * The schedule did eventually self-correct — `scheduleFingerprint` includes the method and the Asr
   * convention, so the next reconciliation notices — but the next reconciliation is the reminder
   * screen mounting or the app returning to the foreground, which can be days. "Correct once the
   * user happens to background the app" is not a reconciliation policy.
   *
   * ── Why the reschedule cannot fail the save ─────────────────────────────────
   * The preference is written first and is not rolled back if the platform refuses to reschedule.
   * The user's chosen method is a fact about what they want and is correct either way; discarding it
   * because 35 alarms could not be created would be the worse outcome, and `reconcilePrayerAlerts`
   * already retains the previous schedule rather than destroying it on failure.
   */
  /*
    A plain patch rather than the store's wider `FaithPreferencesPatch`, which also accepts an
    updater function. This screen's saves are all "set this field to this value", and the object form
    is what lets the reschedule below be decided by *reading the patch* — none of these fields
    derives from its own previous value, so the extra generality would buy nothing and cost the
    check.
  */
  const save = async (patch: Partial<FaithPreferences>, message: string) => {
    await update(patch);
    setSaved(message);
    if (patch.calculationMethod !== undefined || patch.asrMethod !== undefined) {
      await notifications.refreshSchedule();
    }
  };

  /**
   * What the Translation row says beneath its title.
   *
   * Every branch is a real state rather than a placeholder. `resolving` is the genuine gap between
   * opening the app and the catalogue answering, and saying so is better than showing a name that
   * has not been confirmed — which is precisely how a Bosnian edition came to look like a setting
   * somebody had chosen.
   */
  const translationDetail =
    translation !== null
      ? `${translation.language} • ${translation.translator}`
      : status === 'resolving'
        ? 'Choosing an English translation…'
        : status === 'catalogue-unavailable'
          ? 'Translations could not be loaded — tap to try again'
          : 'No English translation is available — tap to choose another';

  return (
    <View style={{ rowGap: dp(moduleLayout.sectionGap) }}>
      {saved === null ? null : (
        <FaithSuccessBanner
          message={saved}
          onDismiss={() => setSaved(null)}
          testID="faith-preferences"
        />
      )}

      {/*
        The banner names the catalogue the *selectors* will show, and reads it from the repository
        rather than asserting one. It stays here rather than on the selection screens themselves,
        where the brief asks for no technical source notice above the list.
      */}
      {quran.source.verified ? null : (
        <ModuleStatusBanner
          tone="warning"
          message="Sample editions only. Licensed translations and reciters arrive with the approved Quran Foundation source."
          testID="faith-preferences-banner"
        />
      )}

      {/*
        ── Two rows, two screens ──────────────────────────────────────────────────
        This group used to be the two catalogues themselves, rendered one after the other in a
        single scroll. Each row now states the current choice and opens a screen that can filter and
        search its own catalogue.
      */}
      <FaithRowGroup title="Qur’an" testID="faith-preferences-quran">
        {[
          <FaithRow
            key="translation"
            title="Translation"
            subtitle={translation?.name ?? 'Not chosen yet'}
            meta={undefined}
            icon="library"
            onPress={() => router.push(faithRoutes.translations)}
            accessibilityLabel={`Translation, ${translation?.name ?? 'not chosen yet'}, ${translationDetail}. Opens the translation list`}
            testID="faith-preferences-translation-row"
          />,
          <FaithRow
            key="translation-detail"
            title={translationDetail}
            testID="faith-preferences-translation-detail"
          />,
        ]}
      </FaithRowGroup>

      {/*
        ── Audio, gathered into one group rather than scattered ──────────────────
        The reciter used to sit under "Qur'an" beside the translation, which put a *listening* choice
        in a group about *reading* editions and left the offline download — the setting with by far
        the largest consequence for the device — reachable only from inside the reciter catalogue.

        Everything about recitation is now in one place: whether it is shown at all, whose voice, what
        is on the device, and whether the column follows along. The storage controls themselves are
        deliberately not here — this group *states* the offline status and opens the screen that owns
        it, because a download of several hundred megabytes does not belong behind a settings row that
        looks like every other settings row.
      */}
      <FaithRowGroup title="Audio" testID="faith-preferences-audio">
        {[
          <FaithRow
            key="audio-enabled"
            title="Recitation player"
            subtitle={
              preferences.quranAudioEnabled
                ? 'Shown at the bottom of the reader'
                : 'Hidden. Downloaded audio is kept.'
            }
            trailing={
              <Switch
                value={preferences.quranAudioEnabled}
                onValueChange={(value) =>
                  void save(
                    { quranAudioEnabled: value },
                    value ? 'Recitation player shown.' : 'Recitation player hidden.',
                  )
                }
                accessibilityLabel="Recitation player"
                accessibilityHint="Shows or hides the player at the bottom of the reader. Downloaded audio is not deleted"
                testID="faith-preference-audio-enabled"
              />
            }
            trailingInteractive
            testID="faith-preferences-audio-enabled-row"
          />,
          <FaithRow
            key="reciter"
            title="Reciter"
            subtitle={reciterName ?? DEFAULT_RECITER_NAME}
            icon="play"
            onPress={() => router.push(faithRoutes.reciters)}
            accessibilityLabel={`Reciter, ${reciterName ?? DEFAULT_RECITER_NAME}. Opens the reciter list`}
            testID="faith-preferences-reciter-row"
          />,
          <FaithRow
            key="offline"
            title="Manage offline audio"
            subtitle={describeOfflineStatus(offline.snapshot)}
            icon="download"
            onPress={() => router.push(faithRoutes.offlineAudio)}
            accessibilityLabel={`Manage offline audio. ${describeOfflineStatus(offline.snapshot)}. Opens the offline audio screen`}
            testID="faith-preferences-offline-audio-row"
          />,
          <FaithRow
            key="auto-scroll"
            title="Follow the recitation"
            subtitle="Scrolls the reading column to the verse being recited"
            trailing={
              <Switch
                value={preferences.quranAutoScroll}
                onValueChange={(value) =>
                  void save(
                    { quranAutoScroll: value },
                    value ? 'The reader will follow the recitation.' : 'Auto-scroll turned off.',
                  )
                }
                accessibilityLabel="Follow the recitation"
                accessibilityHint="Scrolls the reading column to the verse being recited"
                testID="faith-preference-auto-scroll"
              />
            }
            trailingInteractive
            testID="faith-preferences-auto-scroll-row"
          />,
        ]}
      </FaithRowGroup>

      <FaithRowGroup title="Prayer calculation" testID="faith-preferences-methods">
        {METHODS.map((method) => (
          <FaithRow
            key={method.id}
            title={method.label}
            onPress={() =>
              void save(
                { calculationMethod: method.id },
                `Calculation method set to ${method.label}.`,
              )
            }
            trailing={
              preferences.calculationMethod === method.id ? (
                <AppIcon name="check-circle" size={dp(20)} color={theme.ink} />
              ) : undefined
            }
            accessibilityLabel={`${method.label}${preferences.calculationMethod === method.id ? ', selected' : ''}`}
            testID={`faith-preference-method-${method.id}`}
          />
        ))}
      </FaithRowGroup>

      <FaithRowGroup title="Reading" testID="faith-preferences-reading">
        {[
          <FaithRow
            key="asr"
            title="Hanafi Asr timing"
            subtitle="Uses the later shadow-length convention"
            trailing={
              <Switch
                value={preferences.asrMethod === 'hanafi'}
                onValueChange={(value) =>
                  void save({ asrMethod: value ? 'hanafi' : 'standard' }, 'Asr convention updated.')
                }
                accessibilityLabel="Hanafi Asr timing"
                accessibilityHint="Switches Asr between the standard and Hanafi shadow-length conventions"
                testID="faith-preference-asr"
              />
            }
            trailingInteractive
            testID="faith-preference-asr-row"
          />,
          <FaithRow
            key="transliteration"
            /*
              ── Both halves of this row were untrue ───────────────────────────
              It said "Show transliteration" over a flag that named no content, and "Adds a romanised
              reading aid beneath duas" for a Duas feature with no provider behind it. The flag is now
              Qur'an-scoped, and the subtitle states the one thing a user needs to know before
              switching it on: no transliteration source is enabled yet, so this saves a choice rather
              than changing what is on screen. See `FaithPreferences.showQuranTransliteration`.
            */
            title="Show Qur’an transliteration"
            subtitle="Saved for when a transliteration source is available — nothing is shown yet"
            trailing={
              <Switch
                value={preferences.showQuranTransliteration}
                onValueChange={(value) =>
                  void save(
                    { showQuranTransliteration: value },
                    'Qur’an transliteration preference saved.',
                  )
                }
                accessibilityLabel="Show Qur’an transliteration"
                accessibilityHint="Saves your choice. No transliteration source is enabled in this build yet"
                testID="faith-preference-transliteration"
              />
            }
            trailingInteractive
            testID="faith-preference-transliteration-row"
          />,
        ]}
      </FaithRowGroup>
    </View>
  );
}

/**
 * What is on the device, in one line for a settings row.
 *
 * ── Why this says nothing about expiry ──────────────────────────────────────
 * Because for this reciter nothing expires. The extended-retention permission covers Sudais, and the
 * seven-day window it also carries is a *check* obligation rather than a deletion rule — so a row
 * that read "kept for one week" here would describe behaviour the app does not have and the licence
 * does not require. The Offline audio screen states when a check is due; this row states what is
 * present.
 */
export function describeOfflineStatus(snapshot: OfflineSnapshot): string {
  if (snapshot.playableAyat === 0) {
    return 'Nothing downloaded';
  }
  if (snapshot.totalAyat > 0 && snapshot.playableAyat >= snapshot.totalAyat) {
    return `Complete Qur’an • ${formatBytes(snapshot.downloadedBytes)}`;
  }
  return `${snapshot.playableAyat.toLocaleString()} verses • ${formatBytes(snapshot.downloadedBytes)}`;
}
