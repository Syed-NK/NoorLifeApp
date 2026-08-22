import { Modal, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppIcon } from '@ds/components';
import { neutralColors, touchTarget } from '@ds/tokens';
import { ModuleText } from '@features/modules/components';
import { useModuleTheme } from '@features/modules/module-context';
import { moduleLayout, moduleNeutrals, withAlpha } from '@features/modules/module-tokens';
import { useModuleMetrics } from '@features/modules/use-module-metrics';
import { minimumHitSlop } from '@shared/utils/a11y';

import type {
  ExactAlarmCapability,
  NotificationPermission,
} from '../data/notifications/notification.port';
import {
  alertSoundLabel,
  ALERT_SOUND_CHOICES,
  canEverPlayFullAdhan,
  isObligatory,
  normaliseRepeatDays,
  preReminderLabel,
  PRE_REMINDER_CHOICES,
  repeatDaysLabel,
  WEEKDAYS,
  type AlertSoundChoice,
  type PrayerAlertSettings,
  type PreReminderMinutes,
} from '../data/notifications/prayer-alert-preferences';
import { fullAdhanAvailability } from '../data/notifications/prayer-alert-sound';
import type { PrayerKey } from '../data/prayer-times.repository';

/**
 * One time's notification settings, in a sheet over the Prayer screen.
 *
 * ── Why a sheet reached from the row, rather than a settings screen ─────────
 * Because the question a user has is "remind me about *this* prayer", and they have it while looking
 * at that prayer's row. A separate screen makes them find the row again in a second list and match
 * it by name. The Prayer reminders screen still exists and still lists every time — it is where the
 * master switch and the delivery status live — but the per-time choices are edited where the time is.
 *
 * ── Every change is applied immediately, and says so ────────────────────────
 * There is no Save button. Each control writes through the preference store, which serialises its
 * mutations, and the schedule reconciles from the published result — so a "Save" would be a second
 * commit point that could disagree with what the sheet already showed. The header carries a short
 * confirmation instead, and the sheet is closed by the user rather than by a save.
 *
 * ── What this component refuses to claim ───────────────────────────────────
 * It never says "alarm" and never says "exact". Android 12+ gates exact scheduling behind a
 * permission whose runtime grant is not readable from JavaScript, so the honest statement is that
 * timing cannot be confirmed — which is what `exactAlarms` renders as. It also never presents the
 * full adhān as available, because no licensed recording exists; the row is there, disabled, saying
 * so, because a user hunting for the feature deserves to learn that rather than conclude the app
 * forgot it.
 *
 * ── Sunrise ────────────────────────────────────────────────────────────────
 * Offered like the rest, and marked as what it is. Its full-adhān row does not say "not yet": it
 * says sunrise is not a prayer, because that will still be true after a recording is licensed.
 */

/** The modal dim, from the locked scrim token — the same one the reader's sheet uses. */
const SHEET_SCRIM = neutralColors.scrim;

const DAY_DIAMETER_DP = 38;

export type PrayerAlertSheetProps = {
  readonly time: PrayerKey;
  /** The prayer's own name, from the repository. Never a string built here. */
  readonly label: string;
  readonly settings: PrayerAlertSettings;
  /**
   * The master switch's position.
   *
   * A time can be switched on while the master is off, and the sheet says so rather than hiding the
   * controls: the user is configuring something they have paused, which is a reasonable thing to do.
   */
  readonly masterEnabled: boolean;
  readonly permission: NotificationPermission;
  readonly exactAlarms: ExactAlarmCapability;
  readonly onSetNotify: (notify: boolean) => void;
  readonly onSetRepeatDays: (days: readonly number[]) => void;
  readonly onSetPreReminder: (minutes: PreReminderMinutes) => void;
  readonly onSetSound: (sound: AlertSoundChoice) => void;
  readonly onOpenSystemSettings: () => void;
  readonly onClose: () => void;
};

export function PrayerAlertSheet({
  time,
  label,
  settings,
  masterEnabled,
  permission,
  exactAlarms,
  onSetNotify,
  onSetRepeatDays,
  onSetPreReminder,
  onSetSound,
  onOpenSystemSettings,
  onClose,
}: PrayerAlertSheetProps) {
  const theme = useModuleTheme();
  const { dp } = useModuleMetrics();
  const insets = useSafeAreaInsets();

  const prayer = isObligatory(time);
  const adhan = fullAdhanAvailability();
  const testID = `faith-prayer-alert-sheet-${time}`;

  /*
    The day toggles, the pre-reminder and the sound are all editable only while the time is switched
    on. A control that changes a stored value which nothing acts on is a false affordance — and the
    stored value *is* kept, so switching the time back on restores the days the user chose.
  */
  const editable = settings.notify;

  const toggleDay = (day: number) => {
    const selected = new Set(settings.repeatDays);
    if (selected.has(day)) {
      selected.delete(day);
    } else {
      selected.add(day);
    }
    onSetRepeatDays(normaliseRepeatDays([...selected]));
  };

  return (
    <Modal
      visible
      transparent
      /*
        `none`: the sheet has its own scrim, and `slide` translates the scrim with the panel so the
        dimming appears to rise from the bottom edge rather than settle over the page. There is no
        entrance animation here at all — this is a settings surface rather than a gesture surface, and
        an un-animated sheet is one fewer thing between a control and the assertion that it works.
      */
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
      testID={`${testID}-modal`}
    >
      <View style={styles.fill}>
        {/*
          A sibling of the panel rather than its parent, so a press that lands on the sheet cannot
          bubble out and dismiss it — the defect the reader's sheet documents.
        */}
        <View style={styles.scrim}>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={`Close the notification settings for ${label}`}
            style={styles.fill}
            testID={`${testID}-scrim`}
          />
        </View>

        <View
          style={[
            styles.sheet,
            {
              backgroundColor: moduleNeutrals.surface,
              borderTopLeftRadius: dp(moduleLayout.cardRadius),
              borderTopRightRadius: dp(moduleLayout.cardRadius),
              /* The device's own gesture bar, so the last control is never underneath it. */
              paddingBottom: insets.bottom + dp(12),
            },
          ]}
          testID={testID}
        >
          <View
            style={[
              styles.grabber,
              {
                width: dp(36),
                height: dp(4),
                borderRadius: dp(2),
                backgroundColor: moduleNeutrals.border,
                marginTop: dp(8),
              },
            ]}
            accessible={false}
          />

          <View
            style={[
              styles.header,
              { paddingHorizontal: dp(moduleLayout.pagePadding), paddingVertical: dp(10) },
            ]}
          >
            <View style={styles.flex}>
              {/*
                The prayer's real name, from the repository — and it says "notifications", not
                "alarms". Uncapped: a prayer name is one short word and clamping it is what produces
                mid-word breaks at large type sizes.
              */}
              <ModuleText token="cardTitle" accessibilityRole="header" testID={`${testID}-title`}>
                {`${label} notifications`}
              </ModuleText>
              <ModuleText token="caption" testID={`${testID}-subtitle`}>
                {prayer
                  ? 'Changes are saved as you make them.'
                  : 'A time marker, not a prayer. Changes are saved as you make them.'}
              </ModuleText>
            </View>

            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel={`Close the notification settings for ${label}`}
              hitSlop={minimumHitSlop(dp(24))}
              testID={`${testID}-close`}
            >
              <AppIcon name="close" size={dp(20)} color={moduleNeutrals.textPrimary} />
            </Pressable>
          </View>

          <ScrollView
            contentContainerStyle={{
              paddingHorizontal: dp(moduleLayout.pagePadding),
              paddingBottom: dp(8),
              rowGap: dp(14),
            }}
          >
            {/* ── Notify ───────────────────────────────────────────────────── */}
            <View style={styles.controlRow}>
              <View style={styles.flex} accessible accessibilityLabel={`Notify me for ${label}`}>
                <ModuleText token="rowLabel">Notify</ModuleText>
                <ModuleText token="caption">
                  {prayer ? `A notification at ${label}.` : `A reminder at ${label}.`}
                </ModuleText>
              </View>
              {/*
                Outside the accessible group above, deliberately. On Android `accessible` collapses a
                subtree into one node, which once removed every prayer switch from the accessibility
                tree — see `FaithRowProps.trailingInteractive` for the release defect.
              */}
              <Switch
                value={settings.notify}
                onValueChange={onSetNotify}
                accessibilityLabel={`Notify me for ${label}`}
                trackColor={{ true: theme.primary, false: moduleNeutrals.border }}
                testID={`${testID}-notify`}
              />
            </View>

            {/* ── Full adhān: present, disabled, and honest about which reason ── */}
            <View style={styles.controlRow}>
              <View
                style={styles.flex}
                accessible
                accessibilityLabel={`Full adhān for ${label}. ${fullAdhanReason(time, adhan.reason)}`}
              >
                <ModuleText token="rowLabel" color={moduleNeutrals.textTertiary}>
                  Full adhān
                </ModuleText>
                <ModuleText token="caption" testID={`${testID}-full-adhan-reason`}>
                  {fullAdhanReason(time, adhan.reason)}
                </ModuleText>
              </View>
              <Switch
                value={false}
                /*
                  Disabled, and `false` regardless of anything stored. There is no preference behind
                  this control: a stored "play the adhān" that nothing can honour would be the same
                  class of defect as the pre-reminder that sat unread in storage for three releases.
                */
                disabled
                accessibilityLabel={`Full adhān for ${label}`}
                accessibilityState={{ disabled: true, checked: false }}
                trackColor={{ true: theme.primary, false: moduleNeutrals.border }}
                testID={`${testID}-full-adhan`}
              />
            </View>

            {/* ── Repeat days ──────────────────────────────────────────────── */}
            <View style={{ rowGap: dp(8) }}>
              <View style={styles.controlRow}>
                <ModuleText token="rowLabel" style={styles.flex}>
                  Repeat
                </ModuleText>
                <ModuleText token="rowMeta" testID={`${testID}-repeat-summary`}>
                  {repeatDaysLabel(settings.repeatDays)}
                </ModuleText>
              </View>

              <View style={[styles.days, { columnGap: dp(6), rowGap: dp(6) }]}>
                {WEEKDAYS.map((day) => {
                  const selected = settings.repeatDays.includes(day.index);
                  return (
                    <Pressable
                      key={day.index}
                      onPress={() => toggleDay(day.index)}
                      disabled={!editable}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: selected, disabled: !editable }}
                      /* The full day name, because "T" is ambiguous spoken aloud and "S" is worse. */
                      accessibilityLabel={day.name}
                      /*
                        Seven circles have to fit one row at 360 dp, which fixes the drawn diameter
                        below the 44 dp minimum — the case `minimumHitSlop` exists for. Measured on
                        the emulator at 100 px / 2.625 = 38.1 dp before this was added. The 6 dp
                        column gap means two neighbours' expanded areas meet without overlapping, so
                        a tap between them still resolves to the nearer day.
                      */
                      hitSlop={minimumHitSlop(dp(DAY_DIAMETER_DP))}
                      style={[
                        styles.day,
                        {
                          width: dp(DAY_DIAMETER_DP),
                          height: dp(DAY_DIAMETER_DP),
                          borderRadius: dp(DAY_DIAMETER_DP / 2),
                          backgroundColor: selected ? theme.primary : moduleNeutrals.surfaceMuted,
                          borderWidth: selected ? 0 : StyleSheet.hairlineWidth,
                          borderColor: moduleNeutrals.border,
                          opacity: editable ? 1 : 0.5,
                        },
                      ]}
                      testID={`${testID}-day-${day.index}`}
                    >
                      <ModuleText
                        token="rowLabel"
                        color={selected ? theme.onFill : moduleNeutrals.textSecondary}
                        maxFontSizeMultiplier={1.2}
                      >
                        {day.initial}
                      </ModuleText>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {/* ── Pre-prayer reminder ──────────────────────────────────────── */}
            <View style={{ rowGap: dp(8) }}>
              <ModuleText token="rowLabel">
                {prayer ? 'Remind me before' : 'Remind me before sunrise'}
              </ModuleText>
              <View style={[styles.options, { columnGap: dp(6), rowGap: dp(6) }]}>
                {PRE_REMINDER_CHOICES.map((minutes) => (
                  <Choice
                    key={minutes}
                    label={preReminderLabel(minutes)}
                    selected={settings.preReminderMinutes === minutes}
                    disabled={!editable}
                    onPress={() => onSetPreReminder(minutes)}
                    testID={`${testID}-pre-${minutes}`}
                  />
                ))}
              </View>
            </View>

            {/* ── Sound ────────────────────────────────────────────────────── */}
            <View style={{ rowGap: dp(8) }}>
              <ModuleText token="rowLabel">Sound</ModuleText>
              <View style={[styles.options, { columnGap: dp(6), rowGap: dp(6) }]}>
                {ALERT_SOUND_CHOICES.map((choice) => (
                  <Choice
                    key={choice}
                    label={alertSoundLabel(choice)}
                    selected={settings.sound === choice}
                    disabled={!editable}
                    onPress={() => onSetSound(choice)}
                    testID={`${testID}-sound-${choice}`}
                  />
                ))}
              </View>
              <ModuleText token="caption" testID={`${testID}-sound-note`}>
                {/*
                  Named on Android because the user will meet it there: choosing Silent moves these
                  alerts to a second category in the system notification settings, and finding one
                  unexplained is worse than being told.
                */}
                {settings.sound === 'silent'
                  ? 'Silent alerts appear without a sound, under their own category in your system notification settings.'
                  : 'Your device’s default notification sound.'}
              </ModuleText>
            </View>

            {/* ── Honest state, in the order it matters ────────────────────── */}
            <View style={{ rowGap: dp(6) }} testID={`${testID}-status`}>
              {permission === 'granted' ? null : (
                <Notice
                  tone="warning"
                  text={
                    permission === 'denied'
                      ? 'Your device is not allowing NoorLife to send notifications, so nothing will arrive. Your choices here are kept.'
                      : 'NoorLife has not asked to send notifications yet. Switching a time on will ask.'
                  }
                  actionLabel={permission === 'denied' ? 'Open system settings' : undefined}
                  onAction={permission === 'denied' ? onOpenSystemSettings : undefined}
                  testID={`${testID}-permission`}
                />
              )}

              {masterEnabled ? null : (
                <Notice
                  tone="info"
                  text="Prayer notifications are switched off for every time. These choices are kept and take effect when you switch them back on."
                  testID={`${testID}-master-off`}
                />
              )}

              {settings.notify && settings.repeatDays.length === 0 ? (
                <Notice
                  tone="warning"
                  text="No days are selected, so nothing is scheduled for this time."
                  testID={`${testID}-no-days`}
                />
              ) : null}

              <ModuleText token="caption" testID={`${testID}-exactness`}>
                {exactnessText(exactAlarms)}
              </ModuleText>
              <ModuleText token="caption" testID={`${testID}-battery`}>
                NoorLife cannot confirm a notification was delivered. Battery saving, Do Not Disturb
                and your per-category settings can each hold one back.
              </ModuleText>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

/**
 * Why the full-adhān row is disabled, for this particular time.
 *
 * Two different reasons that must not be blurred into one: sunrise will never have an adhān, and the
 * five do not have one *yet*. A single message would either promise sunrise a call to prayer or tell
 * the five they can never have one.
 */
export function fullAdhanReason(time: PrayerKey, unavailableReason: string): string {
  return canEverPlayFullAdhan(time)
    ? unavailableReason
    : 'Sunrise is a time marker, not a prayer, so it never plays an adhān.';
}

/** What the sheet is allowed to say about timing. Never "exact", never "alarm". */
export function exactnessText(capability: ExactAlarmCapability): string {
  switch (capability) {
    case 'available':
      return 'Your device reports that alerts can be delivered at the minute requested.';
    case 'unavailable':
      return 'Your device may batch or delay these alerts, so one can arrive a little after the time shown.';
    case 'unknown':
      return 'Whether this device delivers alerts at the exact minute cannot be confirmed from inside the app.';
    default:
      return 'Alerts are delivered at the time requested, subject to your device’s normal notification timing.';
  }
}

/** A pill in a row of mutually exclusive choices. */
function Choice({
  label,
  selected,
  disabled,
  onPress,
  testID,
}: {
  readonly label: string;
  readonly selected: boolean;
  readonly disabled: boolean;
  readonly onPress: () => void;
  readonly testID: string;
}) {
  const theme = useModuleTheme();
  const { dp } = useModuleMetrics();

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled }}
      accessibilityLabel={label}
      style={{
        paddingHorizontal: dp(12),
        paddingVertical: dp(8),
        /*
          ── Sized rather than slopped, and the difference matters here ────────
          These pills wrap onto a second row with a 6 dp gap. Expanding a 30 dp control to 44 with
          hit slop would push 7 dp past each edge, so the two rows' touch areas would overlap by 8 dp
          and a tap in the gap could land on either row. Growing the pill itself removes the
          ambiguity, and `minimumHitSlop`'s own note prefers sizing the control where the design
          allows it.

          Measured on the emulator at 79 px / 2.625 = 30.1 dp before this was added — below the 44 dp
          minimum that §8 requires.
        */
        minHeight: dp(touchTarget.minimum),
        justifyContent: 'center',
        borderRadius: dp(moduleLayout.radiusSmall),
        backgroundColor: selected ? withAlpha(theme.primary, 0.14) : moduleNeutrals.surfaceMuted,
        borderWidth: selected ? StyleSheet.hairlineWidth : StyleSheet.hairlineWidth,
        borderColor: selected ? theme.primary : moduleNeutrals.border,
        opacity: disabled ? 0.5 : 1,
      }}
      testID={testID}
    >
      <ModuleText
        token="rowMeta"
        color={selected ? theme.ink : moduleNeutrals.textSecondary}
        maxFontSizeMultiplier={1.4}
      >
        {label}
      </ModuleText>
    </Pressable>
  );
}

/** A short honest statement, optionally with the one action that addresses it. */
function Notice({
  tone,
  text,
  actionLabel,
  onAction,
  testID,
}: {
  readonly tone: 'warning' | 'info';
  readonly text: string;
  readonly actionLabel?: string;
  readonly onAction?: () => void;
  readonly testID: string;
}) {
  const { dp } = useModuleMetrics();
  const colour = tone === 'warning' ? moduleNeutrals.warning : moduleNeutrals.info;

  return (
    <View
      style={{
        padding: dp(10),
        borderRadius: dp(moduleLayout.radiusSmall),
        backgroundColor: withAlpha(colour, 0.1),
        rowGap: dp(6),
      }}
      testID={testID}
    >
      <ModuleText token="caption" color={colour}>
        {text}
      </ModuleText>
      {actionLabel === undefined || onAction === undefined ? null : (
        <Pressable
          onPress={onAction}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          testID={`${testID}-action`}
        >
          <ModuleText token="rowMeta" color={colour}>
            {actionLabel}
          </ModuleText>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  scrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: SHEET_SCRIM,
  },
  sheet: {
    marginTop: 'auto',
    maxHeight: '90%',
  },
  grabber: {
    alignSelf: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  flex: {
    flex: 1,
    minWidth: 0,
  },
  controlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 10,
  },
  days: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  day: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  options: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
});
