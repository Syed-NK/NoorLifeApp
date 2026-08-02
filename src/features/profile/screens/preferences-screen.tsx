import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';

import { globalRoutes } from '@application/navigation/routes';
import {
  useAccessibilityActions,
  useAccessibilityPreferences,
} from '@application/providers/accessibility-provider';
import { EntryAuthText } from '@features/entry-auth/components/entry-auth-text';
import { PrimaryButton } from '@features/entry-auth/components/primary-button';
import { SecondaryButton } from '@features/entry-auth/components/secondary-button';
import { useEntryAuthMetrics } from '@features/entry-auth/use-entry-auth-metrics';
import { SubscriptionStateBanner } from '@features/subscription/components/subscription-states';
import { subscriptionColors } from '@features/subscription/subscription-tokens';
import { openDeviceSettings } from '@services/links/external-link.service';
import type { NotificationPermissionPort } from '@services/notifications/notification-permission.service';

import { ProfileDetailCard } from '../components/profile-detail-card';
import { ProfileDetailScaffold } from '../components/profile-detail-scaffold';
import { ProfileStatusRow } from '../components/profile-status-row';
import { ProfileToggleRow } from '../components/profile-toggle-row';
import { useNotificationPermission } from '../hooks/use-notification-permission';
import { preferencesCopy } from '../preferences-copy';
import { profileCopy } from '../profile-copy';

/**
 * Preferences — `/profile/preferences`.
 *
 * ── Four sections, and what each one is allowed to claim ────────────────────
 * Notifications, Language, Appearance, Accessibility. Exactly one of them holds a control that
 * changes anything: Reduce Motion, which is persisted through the shared preference service and
 * read by every animation in the application through `useReducedMotion`.
 *
 * The other three report state and explain a condition. That asymmetry is the screen's whole
 * design. There is no notification stack, no message catalogue and no dark palette, so a switch in
 * any of those sections would remember its position and change nothing — and a preferences screen
 * full of switches that do nothing is the most convincing lie an application can tell, because it
 * looks exactly like a finished one. Each section's audit is recorded above its copy in
 * `preferences-copy.ts`.
 *
 * ── Permission is never requested by arriving here ──────────────────────────
 * `useNotificationPermission` reads on mount and requests only from a press. On Android the system
 * stops offering the prompt after a refusal, so spending that answer because a user opened a
 * settings screen would permanently cost them the ability to say yes later.
 *
 * ── Nothing is lost to navigation ───────────────────────────────────────────
 * The Reduce Motion preference lives in `AccessibilityProvider`, above the navigator, so leaving
 * and returning re-renders this screen against state that never unmounted. The only local state
 * here is transient feedback about the last press.
 */
export function PreferencesScreen({
  /** Injected by the tests to drive the permission states this build cannot reach. */
  notificationPort,
}: {
  readonly notificationPort?: NotificationPermissionPort;
} = {}) {
  const router = useRouter();
  const { dp } = useEntryAuthMetrics();

  const notifications = useNotificationPermission(notificationPort);
  const accessibility = useAccessibilityPreferences();
  const { setPreferReduceMotion, retry } = useAccessibilityActions();

  const [textSizeSettingsFailed, setTextSizeSettingsFailed] = useState(false);

  const openTextSizeSettings = useCallback(async () => {
    setTextSizeSettingsFailed(false);
    const outcome = await openDeviceSettings();
    if (outcome !== 'opened') {
      setTextSizeSettingsFailed(true);
    }
  }, []);

  const copy = preferencesCopy;

  return (
    <ProfileDetailScaffold
      title={copy.title}
      onBack={() => router.dismissTo(globalRoutes.profile)}
      backLabel={profileCopy.detail.backToProfile}
      testID="preferences"
    >
      <NotificationsSection notifications={notifications} />
      <LanguageSection />
      <AppearanceSection />

      <ProfileDetailCard heading={copy.accessibility.heading} testID="preferences-accessibility">
        {/* ── Reduce Motion: the one real preference on this screen ─────────── */}
        {accessibility.status === 'loading' ? (
          <EntryAuthText
            token="caption"
            color={subscriptionColors.textSecondary}
            accessibilityLabel={copy.accessibility.reduceMotion.loading}
            testID="preferences-reduce-motion-loading"
          >
            {copy.accessibility.reduceMotion.loading}
          </EntryAuthText>
        ) : accessibility.status === 'unavailable' ? (
          // The switch is not drawn at all: an off switch would be a claim about a value that
          // could not be read, and the user would have no way to know it was a guess.
          <View style={{ rowGap: dp(8) }} testID="preferences-reduce-motion-unavailable">
            <EntryAuthText token="caption" color={subscriptionColors.textSecondary}>
              {copy.accessibility.reduceMotion.unavailable}
            </EntryAuthText>
            <SecondaryButton
              label={copy.accessibility.reduceMotion.retry}
              onPress={() => void retry()}
              testID="preferences-reduce-motion-retry"
            />
          </View>
        ) : (
          <>
            <ProfileToggleRow
              label={copy.accessibility.reduceMotion.label}
              supporting={copy.accessibility.reduceMotion.supporting}
              // The effective value, so the row shows what animations actually do — which is on
              // whenever the operating system says so, whatever the stored preference is.
              value={accessibility.reduceMotion}
              onValueChange={(next) => void setPreferReduceMotion(next)}
              disabled={accessibility.systemReduceMotion}
              accessibilityHint={copy.accessibility.reduceMotion.accessibilityHint}
              testID="preferences-reduce-motion"
            />

            {accessibility.systemReduceMotion ? (
              <EntryAuthText
                token="caption"
                color={subscriptionColors.textSecondary}
                testID="preferences-reduce-motion-system"
              >
                {copy.accessibility.reduceMotion.systemOverride}
              </EntryAuthText>
            ) : null}

            {accessibility.saveFailed ? (
              <SubscriptionStateBanner
                tone="warning"
                message={copy.accessibility.reduceMotion.saveFailed}
                testID="preferences-reduce-motion-save-failed"
              />
            ) : null}
          </>
        )}

        {/* ── Text size: the system's, with a route to it and no slider ─────── */}
        <View style={{ rowGap: dp(8) }} testID="preferences-text-size">
          <ProfileStatusRow
            label={copy.accessibility.textSize.label}
            supporting={copy.accessibility.textSize.supporting}
            accessibilityLabel={`${copy.accessibility.textSize.label}. ${copy.accessibility.textSize.supporting}`}
            testID="preferences-text-size-row"
          />
          <SecondaryButton
            label={copy.accessibility.textSize.openSettings}
            onPress={() => void openTextSizeSettings()}
            testID="preferences-text-size-settings"
          />
          {textSizeSettingsFailed ? (
            <EntryAuthText
              token="caption"
              color={subscriptionColors.warning}
              testID="preferences-text-size-settings-failed"
            >
              {copy.accessibility.textSize.unavailable}
            </EntryAuthText>
          ) : null}
        </View>

        {/* ── Screen readers: an informational row, never a certification ───── */}
        <ProfileStatusRow
          label={copy.accessibility.screenReader.label}
          supporting={copy.accessibility.screenReader.supporting}
          accessibilityLabel={`${copy.accessibility.screenReader.label}. ${copy.accessibility.screenReader.supporting}`}
          testID="preferences-screen-reader"
        />
      </ProfileDetailCard>
    </ProfileDetailScaffold>
  );
}

/**
 * Notifications.
 *
 * The status is whatever the port reported — including `unavailable`, which is what this build
 * genuinely is. The note beneath is shown whenever NoorLife could not deliver a notification even
 * with permission granted, so a user who has allowed notifications is still told that nothing is
 * sending them yet.
 */
function NotificationsSection({
  notifications,
}: {
  readonly notifications: ReturnType<typeof useNotificationPermission>;
}) {
  const { dp } = useEntryAuthMetrics();
  const copy = preferencesCopy.notifications;

  const statusWord =
    notifications.status === 'checking'
      ? copy.status.checking
      : notifications.status === 'allowed'
        ? copy.status.allowed
        : notifications.status === 'not-allowed'
          ? copy.status.notAllowed
          : notifications.status === 'not-requested'
            ? copy.status.notRequested
            : copy.status.unavailable;

  // Offered only where an explicit press could reach a real system prompt.
  const showAllow = notifications.status === 'not-requested' && notifications.capability.canRequest;
  // Offered only once there is something in settings to change — never for `unavailable`, where
  // the settings screen has no NoorLife notification entry to show.
  const showOpenSettings =
    notifications.status === 'not-allowed' && notifications.capability.canOpenSettings;

  return (
    <ProfileDetailCard heading={copy.heading} testID="preferences-notifications">
      <ProfileStatusRow
        label={copy.statusLabel}
        value={statusWord}
        accessibilityLabel={copy.statusAccessibilityLabel(statusWord)}
        testID="preferences-notifications-status"
      />

      {showAllow ? (
        <PrimaryButton
          label={copy.allow}
          onPress={() => void notifications.requestPermission()}
          loading={notifications.isRequesting}
          accessibilityHint={copy.allowHint}
          testID="preferences-notifications-allow"
        />
      ) : null}

      {showOpenSettings ? (
        <View style={{ rowGap: dp(6) }}>
          <EntryAuthText
            token="caption"
            color={subscriptionColors.textSecondary}
            testID="preferences-notifications-denied"
          >
            {copy.deniedNote}
          </EntryAuthText>
          <SecondaryButton
            label={copy.openSettings}
            onPress={() => void notifications.openSettings()}
            testID="preferences-notifications-settings"
          />
        </View>
      ) : null}

      {notifications.settingsUnavailable ? (
        <EntryAuthText
          token="caption"
          color={subscriptionColors.warning}
          testID="preferences-notifications-settings-failed"
        >
          {copy.settingsUnavailable}
        </EntryAuthText>
      ) : null}

      {/* Shown whenever nothing could actually be delivered — including when permission is
          allowed, because permission is not the same as a reminder existing to send. */}
      {notifications.capability.canDeliver ? null : (
        <EntryAuthText
          token="caption"
          color={subscriptionColors.textSecondary}
          testID="preferences-notifications-note"
        >
          {copy.unavailableNote}
        </EntryAuthText>
      )}
    </ProfileDetailCard>
  );
}

/**
 * Language.
 *
 * `LocalizationProvider` is a boundary with no message catalogue behind it, so English is the
 * current language because it is the only one. Arabic is a deferred row rather than a selectable
 * option — offering it would let a user choose an interface language that does not exist.
 *
 * The second sentence separates Quran Arabic from interface Arabic. NoorLife already renders
 * Arabic scripture, which makes "the app supports Arabic" look true; it is not the same claim, and
 * a user who selected Arabic expecting the interface to change would have been misled.
 */
function LanguageSection() {
  const copy = preferencesCopy.language;

  return (
    <ProfileDetailCard heading={copy.heading} testID="preferences-language">
      <ProfileStatusRow
        label={copy.currentLabel}
        value={copy.english}
        testID="preferences-language-current"
      />

      <ProfileStatusRow
        label={copy.arabic}
        marker={copy.comingLater}
        markerTone="neutral"
        accessibilityLabel={copy.arabicAccessibilityLabel}
        testID="preferences-language-arabic"
      />

      <EntryAuthText
        token="caption"
        color={subscriptionColors.textSecondary}
        testID="preferences-language-note"
      >
        {copy.interfaceNote}
      </EntryAuthText>

      <EntryAuthText
        token="caption"
        color={subscriptionColors.textSecondary}
        testID="preferences-language-quran-note"
      >
        {copy.quranNote}
      </EntryAuthText>
    </ProfileDetailCard>
  );
}

/**
 * Appearance.
 *
 * No token in the design system has a dark counterpart, so a theme control here would darken this
 * screen and leave every other one light. Light is active; System and Dark are deferred rows.
 */
function AppearanceSection() {
  const copy = preferencesCopy.appearance;

  return (
    <ProfileDetailCard heading={copy.heading} testID="preferences-appearance">
      <ProfileStatusRow
        label={copy.currentLabel}
        value={copy.light}
        marker={copy.active}
        markerTone="success"
        accessibilityLabel={copy.lightAccessibilityLabel}
        testID="preferences-appearance-current"
      />

      <ProfileStatusRow
        label={copy.system}
        marker={copy.comingLater}
        markerTone="neutral"
        accessibilityLabel={copy.systemAccessibilityLabel}
        testID="preferences-appearance-system"
      />

      <ProfileStatusRow
        label={copy.dark}
        marker={copy.comingLater}
        markerTone="neutral"
        accessibilityLabel={copy.darkAccessibilityLabel}
        testID="preferences-appearance-dark"
      />

      <EntryAuthText
        token="caption"
        color={subscriptionColors.textSecondary}
        testID="preferences-appearance-note"
      >
        {copy.note}
      </EntryAuthText>
    </ProfileDetailCard>
  );
}
