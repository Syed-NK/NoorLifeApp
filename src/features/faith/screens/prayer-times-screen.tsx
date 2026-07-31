import { useCallback, useState } from 'react';
import { Switch, View } from 'react-native';

import { ModuleText } from '@features/modules/components';
import { ModuleCard } from '@features/modules/components/module-card';
import { useModuleTheme } from '@features/modules/module-context';
import { moduleLayout, moduleNeutrals } from '@features/modules/module-tokens';
import { useModuleMetrics } from '@features/modules/use-module-metrics';

import { FaithRow, FaithRowGroup } from '../components/faith-list';
import { FaithIdentity } from '../components/faith-identity';
import { FaithResourceView, FaithScreen, FaithSuccessBanner } from '../components/faith-screen';
import { hasData } from '../data/faith-result';
import type {
  DailyPrayerTimes,
  PrayerKey,
  PrayerNotificationPreference,
} from '../data/prayer-times.repository';
import { useFaithRepositories } from '../di/faith-repository-context';
import { faithNavKeys } from '../faith-routes';
import { useFaithPreferences } from '../hooks/use-faith-preferences';
import { useFaithResource } from '../hooks/use-faith-resource';
import { todayIso } from '../data/mock/mock-support';

/**
 * Prayer times for today, with per-prayer reminder preferences.
 *
 * ── The reminder toggles are honest about what they do ──────────────────────
 * Turning one on persists the preference; it does **not** schedule an OS notification,
 * because notification scheduling needs a permission flow and a background handler that
 * this phase does not build. The banner says so. A toggle that looked like it armed a
 * reminder and silently did nothing would be the worse option — a user would miss a
 * prayer trusting it.
 */
export function PrayerTimesScreen() {
  const { dp } = useModuleMetrics();
  const { prayerTimes } = useFaithRepositories();
  const { preferences, update } = useFaithPreferences();
  const [savedPrayer, setSavedPrayer] = useState<string | null>(null);

  const settings = {
    method: preferences.calculationMethod,
    asr: preferences.asrMethod,
    offsetsMinutes: {},
  };

  const times = useFaithResource(
    `prayer.today.${preferences.calculationMethod}.${preferences.asrMethod}`,
    useCallback(async () => {
      const location = await prayerTimes.resolveCurrentLocation();
      if (!hasData(location)) {
        return location;
      }
      return prayerTimes.getDailyTimes(location.data, todayIso(), settings);
      // `settings` is derived from preferences, which are in the key.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [prayerTimes, preferences.calculationMethod, preferences.asrMethod]),
  );

  const setNotification = async (prayer: PrayerKey, enabled: boolean) => {
    const next: readonly PrayerNotificationPreference[] = preferences.prayerNotifications.map(
      (entry) => (entry.prayer === prayer ? { ...entry, enabled } : entry),
    );
    await update({ prayerNotifications: next });
    setSavedPrayer(prayer);
  };

  return (
    <FaithScreen title="Prayer Times" activeKey={faithNavKeys.worship} testID="faith-prayer-times">
      <View style={{ rowGap: dp(moduleLayout.sectionGap) }}>
        <FaithIdentity submenu="prayer" summary="Today’s times, and the reminders you choose." />

        {savedPrayer === null ? null : (
          <FaithSuccessBanner
            message="Reminder preference saved. Scheduling arrives with notification support."
            onDismiss={() => setSavedPrayer(null)}
            testID="faith-prayer-times"
          />
        )}

        <FaithResourceView
          resource={times}
          empty={{ title: 'No times available', body: 'Prayer times could not be calculated.' }}
          loadingRows={5}
          testID="faith-prayer-times-body"
        >
          {(day) => <PrayerDay day={day} />}
        </FaithResourceView>

        <FaithRowGroup title="Reminders" testID="faith-prayer-reminders">
          {preferences.prayerNotifications.map((entry) => (
            <FaithRow
              key={entry.prayer}
              title={capitalise(entry.prayer)}
              subtitle={entry.enabled ? `${entry.minutesBefore} minutes before` : 'Off'}
              icon="notification"
              trailing={
                <Switch
                  value={entry.enabled}
                  onValueChange={(value) => void setNotification(entry.prayer, value)}
                  accessibilityLabel={`${capitalise(entry.prayer)} reminder`}
                  testID={`faith-prayer-reminder-${entry.prayer}`}
                />
              }
              accessibilityLabel={`${capitalise(entry.prayer)} reminder, ${entry.enabled ? 'on' : 'off'}`}
              testID={`faith-prayer-reminder-row-${entry.prayer}`}
            />
          ))}
        </FaithRowGroup>
      </View>
    </FaithScreen>
  );
}

function PrayerDay({ day }: { readonly day: DailyPrayerTimes }) {
  const theme = useModuleTheme();
  const { dp } = useModuleMetrics();
  // Sampled once on mount rather than read during render: `Date.now()` in a render body
  // is impure, and a clock that advanced mid-render could highlight two prayers at once.
  const [now] = useState(() => Date.now());
  const nextIndex = day.times.findIndex(
    (time) => time.key !== 'sunrise' && new Date(time.at).getTime() > now,
  );

  return (
    <View style={{ rowGap: dp(moduleLayout.cardGap) }}>
      <ModuleCard testID="faith-prayer-location">
        <ModuleText token="cardTitle" numberOfLines={1}>
          {day.location.label}
        </ModuleText>
        <ModuleText token="caption" numberOfLines={2}>
          {`${day.hijriDate} • ${methodLabel(day.settings.method)}`}
        </ModuleText>
      </ModuleCard>

      <FaithRowGroup title="Today" testID="faith-prayer-list">
        {day.times.map((time, index) => (
          <FaithRow
            key={time.key}
            title={time.label}
            subtitle={time.key === 'sunrise' ? 'Not a prayer — a time marker' : undefined}
            meta={formatTime(time.at)}
            icon={time.key === 'sunrise' ? 'clock' : 'worship'}
            iconColor={index === nextIndex ? theme.ink : moduleNeutrals.textSecondary}
            accessibilityLabel={`${time.label} at ${formatTime(time.at)}${index === nextIndex ? ', next prayer' : ''}`}
            testID={`faith-prayer-time-${time.key}`}
          />
        ))}
      </FaithRowGroup>
    </View>
  );
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  const hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const suffix = hours >= 12 ? 'PM' : 'AM';
  const twelve = hours % 12 === 0 ? 12 : hours % 12;
  return `${twelve}:${minutes} ${suffix}`;
}

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function methodLabel(method: string): string {
  return method
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
