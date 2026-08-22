import { useState } from 'react';
import { Pressable, Switch, View } from 'react-native';

import { AppIcon } from '@ds/components';
import { ModuleStatusBanner, ModuleText } from '@features/modules/components';
import { ModuleCard } from '@features/modules/components/module-card';
import { moduleLayout, moduleNeutrals } from '@features/modules/module-tokens';
import { useModuleMetrics } from '@features/modules/use-module-metrics';
import { minimumHitSlop } from '@shared/utils/a11y';

import { FaithRow, FaithRowGroup } from '../components/faith-list';
import { FaithScreen, FaithSuccessBanner } from '../components/faith-screen';
import { PrayerAlertSheet } from '../components/prayer-alert-sheet';
import { MAX_PENDING_ALERTS, SCHEDULE_HORIZON_DAYS } from '../data/notifications/prayer-alert-plan';
import {
  isObligatory,
  NOTIFIABLE_TIMES,
  preReminderLabel,
  repeatDaysLabel,
  type PrayerAlertSettings,
} from '../data/notifications/prayer-alert-preferences';
import { fullAdhanAvailability } from '../data/notifications/prayer-alert-sound';
import type { PrayerAlertStatus } from '../data/notifications/prayer-notifications.service';
import { formatPrayerClock } from '../data/prayer/prayer-clock';
import { type PrayerKey } from '../data/prayer-times.repository';
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
 * ── Sunrise has a switch now, and still is not a prayer ─────────────────────
 * It used to be structurally absent: the rows were built from `OBLIGATORY_PRAYERS` and no code path
 * could offer an alert for it. It is now offered, because a reminder that the night prayer window
 * has closed is a reasonable thing to want — and everything that made it *not a prayer* is still
 * enforced, in the places that decide rather than by leaving it off a list: its notification never
 * says "prayer time", and its full-adhān row says sunrise never plays one rather than "not yet".
 *
 * ── Where the per-time choices live ─────────────────────────────────────────
 * In a sheet opened from the row, not on this screen. Repeat days, a pre-reminder and a sound are
 * three controls each; six times would be eighteen controls in one scroll, and the question a user
 * has is about one prayer at a time. The row keeps its switch — a fast on/off is worth having — and
 * pressing the row opens everything else.
 */
/**
 * The settings button's drawn size beside each row's switch.
 *
 * 28 dp drawn with `minimumHitSlop` taking the touchable area to the 44 dp minimum, so it sits
 * beside a Switch inside the row's existing height rather than growing every row.
 */
const SETTINGS_BUTTON_DP = 28;

export function PrayerRemindersScreen() {
  const { dp } = useModuleMetrics();
  const { preferences, persistenceError } = useFaithPreferences();
  const notifications = usePrayerNotifications();
  const [tested, setTested] = useState<'sent' | 'failed' | null>(null);
  /** Which time’s sheet is open, or `null`. One at a time, by construction. */
  const [openSheet, setOpenSheet] = useState<PrayerKey | null>(null);

  const { status } = notifications;
  const settingsFor = (time: PrayerKey): PrayerAlertSettings => notifications.settingsForTime(time);
  const adhan = fullAdhanAvailability();

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

        {/*
          A failed write is reported where it happened rather than swallowed. Without this a switch
          moves, the schedule is rebuilt from the new value, and the next launch reads the old one
          back from storage — the switch appears to have undone itself for no stated reason.
        */}
        {persistenceError === null ? null : (
          <ModuleStatusBanner
            tone="warning"
            message={persistenceError}
            testID="faith-prayer-reminders-persistence-error"
          />
        )}

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
              /*
                ── The copy defect this replaces ─────────────────────────────
                This used to read "Alerts are scheduled at each prayer time" whenever
                `preferenceEnabled` was true. The preference being on is a statement about a switch,
                not about the platform: with permission denied, no location, or a scheduling call the
                device refused, nothing was pending and the row still said alerts were scheduled.
                `masterSubtitle` reads the reconciled pending state instead, and says "scheduled"
                only when `schedule.kind === 'scheduled'` — which is only reachable after matching
                identifiers were found in the platform's own pending list.
              */
              subtitle={masterSubtitle(status)}
              icon="notification"
              trailing={
                <Switch
                  value={preferences.prayerNotificationsEnabled}
                  onValueChange={(value) => void notifications.setMasterEnabled(value)}
                  accessibilityLabel="Enable prayer notifications"
                  accessibilityHint="Turns all prayer reminders on or off"
                  testID="faith-prayer-notifications-master"
                />
              }
              /*
                Keeps the row container out of the accessibility tree so the switch stays an
                `android.widget.Switch` in its own right. See `FaithRowProps.trailingInteractive`.
              */
              trailingInteractive
              testID="faith-prayer-notifications-master-row"
            />,
          ]}
        </FaithRowGroup>

        {/*
          All six of the day’s times. Sunrise is among them and is labelled as a time marker; what
          makes it not a prayer is enforced where it matters, not by leaving it off this list.
        */}
        <FaithRowGroup title="Times" testID="faith-prayer-reminders">
          {NOTIFIABLE_TIMES.map((time) => (
            <FaithRow
              key={time}
              title={capitalise(time)}
              /*
                The row states the *preference*, in preference words. Whether it produced a pending
                request is the status panel’s business — six rows each claiming "scheduled" would be
                six chances to make a promise the platform has not confirmed.
              */
              subtitle={perTimeSubtitle(settingsFor(time), isObligatory(time))}
              icon="notification"
              /*
                ── Two controls, not a pressable row ─────────────────────────────
                This row used to pass `onPress` as well as `trailingInteractive`, and `FaithRow`
                silently dropped it: with an interactive trailing control the row deliberately
                returns a non-pressable container, for a good reason of its own — a row press that
                also toggled the switch would put two handlers on one gesture.

                So nothing opened. `uiautomator` reported the row as `clickable=false` on the
                device while the Jest case passed, because `fireEvent.press` calls the prop
                directly and never goes near the platform tree — the same trap that once hid six
                unreachable switches.

                A settings button beside the switch is the honest shape: two distinct actions, two
                independently focusable nodes, and no gesture shared between them.
              */
              trailing={
                <View style={{ flexDirection: 'row', alignItems: 'center', columnGap: dp(4) }}>
                  <Switch
                    value={settingsFor(time).notify}
                    onValueChange={(value) => void notifications.setNotify(time, value)}
                    disabled={!preferences.prayerNotificationsEnabled}
                    accessibilityLabel={`Notify me for ${capitalise(time)}`}
                    accessibilityHint={
                      preferences.prayerNotificationsEnabled
                        ? `Turns the ${capitalise(time)} notification on or off`
                        : 'Switch prayer notifications on first'
                    }
                    testID={`faith-prayer-reminder-${time}`}
                  />
                  <Pressable
                    onPress={() => setOpenSheet(time)}
                    accessibilityRole="button"
                    accessibilityLabel={`Notification settings for ${capitalise(time)}`}
                    accessibilityHint={`Opens days, pre-reminder and sound for ${capitalise(time)}`}
                    hitSlop={minimumHitSlop(dp(SETTINGS_BUTTON_DP))}
                    style={{
                      width: dp(SETTINGS_BUTTON_DP),
                      height: dp(SETTINGS_BUTTON_DP),
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                    testID={`faith-prayer-reminder-open-${time}`}
                  >
                    <AppIcon
                      name="chevron-forward"
                      size={dp(16)}
                      color={moduleNeutrals.textSecondary}
                    />
                  </Pressable>
                </View>
              }
              trailingInteractive
              accessibilityLabel={`${capitalise(time)}. ${perTimeSubtitle(
                settingsFor(time),
                isObligatory(time),
              )}.`}
              testID={`faith-prayer-reminder-row-${time}`}
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
            {/*
              The master preference and the OS permission, on separate lines, because they are
              separate facts and the old copy conflated them. "Reminders on" and "the device will
              show them" have independent answers, and either one alone explains a missed prayer.
            */}
            <StatusLine
              label="Reminders preference"
              value={preferences.prayerNotificationsEnabled ? 'On' : 'Off'}
              testID="preference"
            />
            <StatusLine
              label="Times selected"
              value={selectedTimesText(preferences.prayerAlerts)}
              testID="selected"
            />
            <StatusLine
              label="Notification permission"
              value={permissionText(status)}
              testID="permission"
            />
            <StatusLine label="Exact alarms" value={exactAlarmText(status)} testID="exact-alarms" />
            <StatusLine
              label="Last reconciliation"
              value={reconciliationText(status, notifications.busy)}
              testID="reconciliation"
            />
            <StatusLine label="Sound" value={soundsText(preferences.prayerAlerts)} testID="sound" />
            {/*
              Stated rather than omitted. A user looking for a call to prayer should find out here
              that NoorLife does not have one, instead of concluding it failed to play.
            */}
            <StatusLine
              label="Full adhān"
              value={adhan.available ? adhan.reason : 'Not available'}
              hint={adhan.available ? undefined : adhan.reason}
              testID="full-adhan"
            />
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
            <StatusLine
              label="Pending requests"
              value={pendingRequestsText(status)}
              hint={horizonHint}
              testID="freshness"
            />
            {/*
              The last line, and the one the other seven exist to qualify. `deliveryVerifiable` is a
              field on the status precisely so this cannot quietly become "working" — see the type.
            */}
            <StatusLine
              label="Delivery"
              value="Cannot be confirmed — NoorLife sees pending requests, not deliveries"
              testID="delivery"
            />
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

      {/*
        One sheet, for whichever time was pressed. Rendered at the screen’s root rather than inside
        a row so that a row unmounting — which a preference change causes — cannot take the open
        sheet with it.
      */}
      {openSheet === null ? null : (
        <PrayerAlertSheet
          time={openSheet}
          label={capitalise(openSheet)}
          settings={settingsFor(openSheet)}
          masterEnabled={preferences.prayerNotificationsEnabled}
          permission={status?.permission ?? 'undetermined'}
          exactAlarms={status?.exactAlarms ?? 'unknown'}
          onSetNotify={(notify) => void notifications.setNotify(openSheet, notify)}
          onSetRepeatDays={(days) => void notifications.setRepeatDays(openSheet, days)}
          onSetPreReminder={(minutes) => void notifications.setPreReminder(openSheet, minutes)}
          onSetSound={(sound) => void notifications.setSound(openSheet, sound)}
          onOpenSystemSettings={() => void notifications.openSystemSettings()}
          onClose={() => setOpenSheet(null)}
        />
      )}
    </FaithScreen>
  );
}

/**
 * The one sentence that makes the pending *count* interpretable.
 *
 * ── Why a count alone is not self-explanatory ───────────────────────────────
 * "6 pending" with one prayer switched on reads like a defect until you know the schedule spans
 * several days. It does: `SCHEDULE_HORIZON_DAYS` calendar days from today at the prayer location,
 * one request per selected prayer per day, with any occurrence already past today left out. So one
 * prayer selected at two in the afternoon is six requests — tomorrow through day six — and that is
 * correct rather than a duplicate.
 *
 * Stated in the UI because the count is the number a user would otherwise have to guess at, and
 * because a number nobody can check is a number nobody can challenge.
 */
const horizonHint = `Up to ${MAX_PENDING_ALERTS} requests, covering at most ${SCHEDULE_HORIZON_DAYS} days: one per selected time each day, plus one for each pre-reminder. Times already past today are not scheduled, and the soonest are kept when the ceiling is reached.`;

function StatusLine({
  label,
  value,
  hint,
  testID,
}: {
  readonly label: string;
  readonly value: string;
  /** An extra clause for the spoken label only, where the value alone would invite a wrong reading. */
  readonly hint?: string;
  readonly testID: string;
}) {
  const { dp } = useModuleMetrics();
  return (
    <View
      style={{ flexDirection: 'row', columnGap: dp(8), alignItems: 'flex-start' }}
      accessible
      accessibilityLabel={`${label}: ${value}${hint === undefined ? '' : `. ${hint}`}`}
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

/**
 * The master row's subtitle, derived from pending requests rather than from the switch.
 *
 * The word "scheduled" appears on exactly one branch: `kind === 'scheduled'`, which
 * `reconcilePrayerAlerts` only returns after it has matched its stored identifiers against the
 * platform's own pending list. Every other state says what is actually true instead — including the
 * one that used to be indistinguishable from success, where the preference is on and the schedule
 * failed.
 */
function masterSubtitle(status: PrayerAlertStatus | null): string {
  if (status === null) {
    return 'Checking what is scheduled…';
  }
  if (!status.preferenceEnabled) {
    return 'Off — nothing is scheduled';
  }
  switch (status.schedule.kind) {
    case 'scheduled':
      return `On — ${countLabel(status.schedule.count)} pending on this device`;
    case 'stale':
      return `On — ${countLabel(status.schedule.count)} pending, from settings that have since changed`;
    case 'failed':
      return `On, but nothing could be scheduled — ${failureReason(status.schedule.reason)}`;
    case 'none':
      /* Master on with every prayer off. The preference is on; there is correctly nothing pending. */
      return 'On — no prayers selected, so nothing is scheduled';
  }
}

/**
 * A per-prayer row's subtitle. Preference words only.
 *
 * The one qualification it does make is the case where the switch is on and the module as a whole has
 * nothing pending — otherwise five rows would read "Alert at the prayer time" over a schedule that
 * does not exist, which is the same claim the master row was corrected for.
 */
/**
 * One line describing a time's own choices.
 *
 * Built from the settings alone and never from the schedule state, so it cannot imply that
 * something is pending. "Every day" is what the user chose; whether the device will deliver it is
 * four separate lines in the status panel.
 */
export function perTimeSubtitle(settings: PrayerAlertSettings, prayer: boolean): string {
  const marker = prayer ? '' : ' · time marker, not a prayer';
  if (!settings.notify) {
    return `Off${marker}`;
  }
  if (settings.repeatDays.length === 0) {
    return `On, but no days selected${marker}`;
  }
  const before =
    settings.preReminderMinutes === 0
      ? ''
      : ` · ${preReminderLabel(settings.preReminderMinutes)} before`;
  return `${repeatDaysLabel(settings.repeatDays)}${before}${marker}`;
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
  switch (status.schedule.kind) {
    case 'scheduled':
      /*
        The honest ceiling, stated even in the good case. NoorLife knows what is pending; it cannot
        know what arrives.
      */
      return `${countLabel(status.schedule.count)} are pending on this device. NoorLife cannot confirm delivery — silent mode, Focus and battery settings can each suppress a notification.`;
    case 'stale':
      return 'Alerts are pending, but they were built before your current settings. Refresh the schedule to rebuild them.';
    case 'failed':
      return `Nothing is scheduled — ${failureReason(status.schedule.reason)}.`;
    case 'none':
      return 'No prayers are selected, so nothing is scheduled.';
  }
}

/** Why the last reconciliation produced no schedule, in one clause that fits mid-sentence. */
function failureReason(
  reason: Extract<PrayerAlertStatus['schedule'], { kind: 'failed' }>['reason'],
) {
  switch (reason) {
    case 'permission':
      return 'this device is not allowing NoorLife to show notifications';
    case 'location':
      return 'no location is set for prayer times';
    case 'calculation':
      return 'prayer times could not be calculated';
    case 'platform-refused':
      return 'the device refused to create the alerts';
  }
}

function countLabel(count: number): string {
  return count === 1 ? '1 alert' : `${count} alerts`;
}

function selectedTimesText(entries: readonly PrayerAlertSettings[]): string {
  const on = entries.filter((entry) => entry.notify).map((entry) => capitalise(entry.time));
  return on.length === 0 ? 'None' : on.join(', ');
}

/**
 * Which sounds the switched-on times are using.
 *
 * A summary rather than one value, because the choice is per time now. It names both when they
 * differ, so a user who silenced Fajr alone is not told everything is silent.
 */
function soundsText(entries: readonly PrayerAlertSettings[]): string {
  const on = entries.filter((entry) => entry.notify);
  if (on.length === 0) {
    return 'System default';
  }
  const silent = on.filter((entry) => entry.sound === 'silent').length;
  if (silent === 0) {
    return 'System default';
  }
  return silent === on.length ? 'Silent' : 'System default for some times, silent for others';
}

/**
 * Whether the app's picture of the schedule is current, which is separate from whether that schedule
 * exists. A reconciliation can succeed and correctly find nothing.
 */
function reconciliationText(status: PrayerAlertStatus | null, busy: boolean): string {
  if (busy) {
    return 'Checking now…';
  }
  if (status === null) {
    return 'Not yet run';
  }
  switch (status.schedule.kind) {
    case 'scheduled':
      return 'Matched the device’s pending list';
    case 'stale':
      return 'Could not run — pending alerts left in place';
    case 'failed':
      return `Failed — ${failureReason(status.schedule.reason)}`;
    case 'none':
      return 'Ran — nothing to schedule';
  }
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

/**
 * How many requests the platform is actually holding — the only number on this screen that comes
 * from the device rather than from a preference.
 *
 * `failed` reports the *retained* count, because a failed reconciliation does not cancel what was
 * already pending: the previous schedule is deliberately left in place, and saying "0" while five
 * alerts are still queued would be as wrong as the claim this screen was corrected for.
 */
function pendingRequestsText(status: PrayerAlertStatus | null): string {
  const schedule = status?.schedule;
  switch (schedule?.kind) {
    case 'scheduled':
      /* The span, visibly, so the count is interpretable without a screen reader. See `horizonHint`. */
      return `${schedule.count} pending • next ${SCHEDULE_HORIZON_DAYS} days`;
    case 'stale':
      return `${schedule.count} pending, but out of date`;
    case 'failed':
      return schedule.retainedCount === 0
        ? 'None pending'
        : `${schedule.retainedCount} pending from the previous schedule`;
    case 'none':
      return 'None pending';
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
