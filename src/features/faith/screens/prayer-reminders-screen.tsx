import { useState } from 'react';
import { Switch, View } from 'react-native';

import { ModuleStatusBanner, ModuleText } from '@features/modules/components';
import { ModuleCard } from '@features/modules/components/module-card';
import { moduleLayout } from '@features/modules/module-tokens';
import { useModuleMetrics } from '@features/modules/use-module-metrics';

import { FaithRow, FaithRowGroup } from '../components/faith-list';
import { FaithScreen, FaithSuccessBanner } from '../components/faith-screen';
import { prayerAlertSoundLabel } from '../data/notifications/prayer-alert-sound';
import type { PrayerAlertStatus } from '../data/notifications/prayer-notifications.service';
import { formatPrayerClock } from '../data/prayer/prayer-clock';
import { OBLIGATORY_PRAYERS, type PrayerKey } from '../data/prayer-times.repository';
import { faithNavKeys } from '../faith-routes';
import { useFaithPreferences } from '../hooks/use-faith-preferences';
import { usePrayerNotifications } from '../hooks/use-prayer-notifications';

/**
 * Prayer alerts — what is scheduled, what is not, and what NoorLife cannot promise.
 *
 * ── What this replaced ──────────────────────────────────────────────────────
 * A screen of five switches behind a banner reading "these are preferences only, nothing will be
 * delivered". That was true and is no longer: alerts are now real local notifications scheduled from
 * the same instants the Prayer screen displays.
 *
 * ── The claim this screen is careful never to make ──────────────────────────
 * That a reminder *will arrive*. NoorLife can prove an alert is **pending** — it holds the platform's
 * own identifier and re-checks it against the platform's pending list on every launch. It cannot
 * prove one was **delivered**: there is no receipt, and Do Not Disturb, battery optimisation and
 * per-channel settings can each suppress one silently. So every state below is reported separately,
 * and `deliveryVerifiable` is a field rather than a comment.
 *
 * ── Sunrise has no switch, and cannot ───────────────────────────────────────
 * The rows are built from `OBLIGATORY_PRAYERS`, the domain's own list of the five. Sunrise is a
 * clock reading, not an act of worship, and there is no code path that could offer an alert for it.
 */
export function PrayerRemindersScreen() {
  const { dp } = useModuleMetrics();
  const { preferences } = useFaithPreferences();
  const notifications = usePrayerNotifications();
  const [tested, setTested] = useState<'sent' | 'failed' | null>(null);

  const { status } = notifications;
  const enabledFor = (prayer: PrayerKey): boolean =>
    preferences.prayerNotifications.find((entry) => entry.prayer === prayer)?.enabled ?? false;

  return (
    <FaithScreen
      title="Prayer reminders"
      activeKey={faithNavKeys.worship}
      testID="faith-prayer-reminders-screen"
    >
      <View style={{ rowGap: dp(moduleLayout.sectionGap) }}>
        {/*
          Before the controls, and it says what is true *now* rather than what was true before
          scheduling existed. The one thing it must keep saying is that delivery cannot be confirmed.
        */}
        <ModuleStatusBanner
          tone={status?.permission === 'granted' ? 'info' : 'warning'}
          message={bannerMessage(status)}
          testID="faith-prayer-reminders-notice"
        />

        {tested === null ? null : (
          <FaithSuccessBanner
            message={
              tested === 'sent'
                ? 'Test notification sent. If it did not appear, check this app’s notification settings.'
                : 'The test notification could not be sent. Check this app’s notification settings.'
            }
            onDismiss={() => setTested(null)}
            testID="faith-prayer-reminders-test-result"
          />
        )}

        <FaithRowGroup testID="faith-prayer-reminders-master">
          {[
            <FaithRow
              key="master"
              title="Enable prayer notifications"
              subtitle={
                status?.preferenceEnabled === true
                  ? 'Alerts are scheduled at each prayer time'
                  : 'No alerts are scheduled'
              }
              icon="notification"
              trailing={
                <Switch
                  value={preferences.prayerNotificationsEnabled}
                  onValueChange={(value) => void notifications.setMasterEnabled(value)}
                  accessibilityLabel="Enable prayer notifications"
                  testID="faith-prayer-notifications-master"
                />
              }
              testID="faith-prayer-notifications-master-row"
            />,
          ]}
        </FaithRowGroup>

        {/*
          Built from the domain's five. Sunrise is structurally absent — see the note above.
        */}
        <FaithRowGroup title="Prayers" testID="faith-prayer-reminders">
          {OBLIGATORY_PRAYERS.map((prayer) => (
            <FaithRow
              key={prayer}
              title={capitalise(prayer)}
              subtitle={enabledFor(prayer) ? 'Alert at the prayer time' : 'Off'}
              icon="notification"
              trailing={
                <Switch
                  value={enabledFor(prayer)}
                  onValueChange={(value) => void notifications.setPrayerEnabled(prayer, value)}
                  disabled={!preferences.prayerNotificationsEnabled}
                  accessibilityLabel={`${capitalise(prayer)} alert`}
                  testID={`faith-prayer-reminder-${prayer}`}
                />
              }
              accessibilityLabel={`${capitalise(prayer)} alert, ${enabledFor(prayer) ? 'on' : 'off'}.`}
              testID={`faith-prayer-reminder-row-${prayer}`}
            />
          ))}
        </FaithRowGroup>

        {/*
          ── The state panel ────────────────────────────────────────────────────
          Six separate facts, not one summary. Collapsing them into "reminders are on" is exactly the
          claim this feature cannot support: the preference, the OS permission, the exact-alarm
          capability and whether anything is actually pending are independent, and any of them can be
          the reason a prayer alert did not arrive.
        */}
        <ModuleCard testID="faith-prayer-notification-status">
          <View style={{ rowGap: dp(6) }}>
            <ModuleText token="cardHeading">Status</ModuleText>
            <StatusLine
              label="Notification permission"
              value={permissionText(status)}
              testID="permission"
            />
            <StatusLine label="Exact alarms" value={exactAlarmText(status)} testID="exact-alarms" />
            <StatusLine label="Sound" value={prayerAlertSoundLabel()} testID="sound" />
            <StatusLine
              label="Location used for scheduling"
              value={preferences.locationLabel ?? 'Set on the Prayer Times screen'}
              testID="location"
            />
            <StatusLine
              label="Calculation method"
              value={methodLabel(preferences.calculationMethod)}
              testID="method"
            />
            <StatusLine label="Next scheduled alert" value={nextAlertText(status)} testID="next" />
            <StatusLine label="Schedule" value={freshnessText(status)} testID="freshness" />
          </View>
        </ModuleCard>

        <FaithRowGroup testID="faith-prayer-notification-actions">
          {[
            <FaithRow
              key="refresh"
              title="Refresh schedule"
              subtitle={
                notifications.busy ? 'Checking…' : 'Rebuild alerts from your current settings'
              }
              icon="retry"
              onPress={() => void notifications.refreshSchedule()}
              testID="faith-prayer-notifications-refresh"
            />,
            <FaithRow
              key="settings"
              title="Open system settings"
              subtitle="Notification and alarm permissions for NoorLife"
              icon="settings"
              onPress={() => void notifications.openSystemSettings()}
              testID="faith-prayer-notifications-settings"
            />,
            <FaithRow
              key="test"
              title="Send a test notification"
              subtitle="Clearly labelled as a test — not a prayer alert"
              icon="send"
              onPress={() => {
                void notifications
                  .sendTestNotification()
                  .then((ok) => setTested(ok ? 'sent' : 'failed'));
              }}
              testID="faith-prayer-notifications-test"
            />,
          ]}
        </FaithRowGroup>
      </View>
    </FaithScreen>
  );
}

function StatusLine({
  label,
  value,
  testID,
}: {
  readonly label: string;
  readonly value: string;
  readonly testID: string;
}) {
  const { dp } = useModuleMetrics();
  return (
    <View
      style={{ flexDirection: 'row', columnGap: dp(8), alignItems: 'flex-start' }}
      accessible
      accessibilityLabel={`${label}: ${value}`}
      testID={`faith-prayer-notification-${testID}`}
    >
      <ModuleText token="rowMeta" style={{ flex: 1 }}>
        {label}
      </ModuleText>
      <ModuleText token="rowLabel" style={{ flex: 1 }} align="right">
        {value}
      </ModuleText>
    </View>
  );
}

function bannerMessage(status: PrayerAlertStatus | null): string {
  if (status === null) {
    return 'Checking your notification settings…';
  }
  if (!status.preferenceEnabled) {
    return 'Prayer notifications are off. Nothing is scheduled.';
  }
  if (status.permission !== 'granted') {
    return 'Your choices are saved, but this device is not allowing NoorLife to show notifications, so nothing will be delivered.';
  }
  /*
    The honest ceiling, stated even in the good case. NoorLife knows what is pending; it cannot know
    what arrives.
  */
  return 'Alerts are scheduled on this device. NoorLife cannot confirm delivery — silent mode, Focus and battery settings can each suppress a notification.';
}

function permissionText(status: PrayerAlertStatus | null): string {
  switch (status?.permission) {
    case 'granted':
      return 'Granted';
    case 'denied':
      return 'Not allowed';
    case 'undetermined':
      return 'Not yet requested';
    default:
      return 'Checking…';
  }
}

function exactAlarmText(status: PrayerAlertStatus | null): string {
  switch (status?.exactAlarms) {
    case 'available':
      return 'Available';
    case 'unavailable':
      return 'Not available — alerts may be delayed';
    case 'not-required':
      return 'Not required on this platform';
    case 'unknown':
      /* See `ExactAlarmCapability`: the runtime grant is not readable from JavaScript in SDK 57. */
      return 'Requested; cannot be confirmed on this device';
    default:
      return 'Checking…';
  }
}

function nextAlertText(status: PrayerAlertStatus | null): string {
  const schedule = status?.schedule;
  if (schedule?.kind === 'scheduled' && schedule.nextAt !== null) {
    return `${schedule.nextLabel ?? 'Next'} at ${formatPrayerClock(schedule.nextAt)}`;
  }
  return 'None scheduled';
}

function freshnessText(status: PrayerAlertStatus | null): string {
  const schedule = status?.schedule;
  switch (schedule?.kind) {
    case 'scheduled':
      return `${schedule.count} pending`;
    case 'stale':
      return `${schedule.count} pending, but out of date`;
    case 'failed':
      return schedule.reason === 'permission'
        ? 'Not scheduled — permission needed'
        : schedule.reason === 'location'
          ? 'Not scheduled — no location'
          : schedule.reason === 'calculation'
            ? 'Not scheduled — times unavailable'
            : 'Not scheduled — the device refused';
    case 'none':
      return 'Nothing scheduled';
    default:
      return 'Checking…';
  }
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
