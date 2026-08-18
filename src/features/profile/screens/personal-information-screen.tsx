import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { BackHandler, StyleSheet, View } from 'react-native';

import { authRoutes, globalRoutes } from '@application/navigation/routes';
import { useAuth, useAuthActions } from '@application/providers/auth-provider';
import { AuthStatusBanner } from '@features/entry-auth/components/auth-status-banner';
import { AuthTextField } from '@features/entry-auth/components/auth-text-field';
import { EntryAuthText } from '@features/entry-auth/components/entry-auth-text';
import { PrimaryButton } from '@features/entry-auth/components/primary-button';
import { SecondaryButton } from '@features/entry-auth/components/secondary-button';
import { useEntryAuthMetrics } from '@features/entry-auth/use-entry-auth-metrics';
import { useSubmit } from '@features/entry-auth/use-auth-error';
import { profileAvatar } from '@features/home/module-pictograms';
import { subscriptionColors } from '@features/subscription/subscription-tokens';

import { ProfileDetailCard, ProfileDetailRow } from '../components/profile-detail-card';
import { ProfileDetailScaffold } from '../components/profile-detail-scaffold';
import { ProfileDialog } from '../components/profile-dialog';
import { ProfileSkeletonBar } from '../components/profile-skeleton-bar';
import { useAuthProviderId } from '../hooks/use-auth-provider-id';
import { useProfileRecord } from '../hooks/use-profile-record';
import { profileCopy } from '../profile-copy';
import { PROFILE_LAYOUT } from '../profile-metrics';
import {
  PROFILE_NAME_MAX_LENGTH,
  hasNameChanged,
  validateFullName,
  type ProfileNameProblem,
} from '../profile-name';

/**
 * Personal Information — `/profile/edit`.
 *
 * ── What it can actually change ─────────────────────────────────────────────
 * One field: `profiles.full_name`. Everything else on the screen is shown because the user needs to
 * see it, and is read-only because this screen does not own it. The address belongs to `auth.users`
 * and changing it is a confirmation flow; the photo has no storage contract at all. Both say so, in
 * a sentence, rather than offering a control that would fail or — worse — appear to succeed.
 *
 * ── Where the data comes from ───────────────────────────────────────────────
 * The name from `useProfileRecord` (the durable row) falling back to the session's own cached copy;
 * the address and the sign-in provider from the authenticated session. Nothing on this screen is a
 * fixture, and there is no code path that substitutes a plausible-looking stand-in for an absent
 * value — an unknown provider renders no provider row at all.
 *
 * ── Where the write goes ────────────────────────────────────────────────────
 * `useAuthActions().updateFullName`, which calls the profile service and then updates the shared
 * auth state. That second half is what makes Profile Home's identity card and Main Home's greeting
 * correct immediately: they read the same state, and the durable row notifies its readers to
 * re-read. This screen never imports the Supabase client — a test asserts as much.
 *
 * ── Leaving with an unsaved edit ────────────────────────────────────────────
 * Both the header's Back and the Android hardware button route through one `requestBack`, so the
 * discard confirmation cannot be reachable by one and bypassed by the other.
 */
export function PersonalInformationScreen() {
  const router = useRouter();
  const { dp } = useEntryAuthMetrics();

  const { status, user } = useAuth();
  const { updateFullName } = useAuthActions();
  const record = useProfileRecord(user?.id ?? null);
  const authProvider = useAuthProviderId();
  const submit = useSubmit();

  /** The durable name where it is known, the session's cached copy otherwise. Never invented. */
  const storedName = record.fullName ?? user?.fullName ?? null;

  /**
   * What the user has typed, or null while they have typed nothing.
   *
   * ── Why the field's value is derived rather than seeded ─────────────────────
   * The obvious shape is a `useState` initialised from the stored name in an effect. It is also
   * wrong twice over: the stored name is not known on the first render, so the effect would be a
   * synchronous setState that cascades a second render, and the field would briefly exist holding an
   * empty string — which reads as "this account has no name". Deriving instead means there is
   * exactly one source for the displayed value and no frame in which it is a placeholder.
   */
  const [draft, setDraft] = useState<string | null>(null);
  /** True once the user has edited, which is what gates the inline message. */
  const [touched, setTouched] = useState(false);
  const [savedName, setSavedName] = useState<string | null>(null);
  const [discardVisible, setDiscardVisible] = useState(false);

  /** Null only while no name is known from either source; the field is a skeleton until then. */
  const value = draft ?? storedName;

  /**
   * Signed out — leave, without drawing anything.
   *
   * `dismissAll` before `replace` is what makes Back unable to return: replacing alone would swap
   * this screen for Authentication while leaving Profile and Main Home beneath it in the stack.
   */
  useEffect(() => {
    if (status !== 'signed-out') {
      return;
    }
    if (router.canDismiss()) {
      router.dismissAll();
    }
    router.replace(authRoutes.welcome);
  }, [router, status]);

  const validation = validateFullName(value ?? '');
  // An untouched field is never dirty, whatever the stored name happens to be.
  const dirty = draft !== null && hasNameChanged(draft, storedName);
  const canSave = dirty && validation.ok && !submit.loading;

  /** Profile Home, not Main Home. `dismissTo` pops to it when it is on the stack. */
  const leave = useCallback(() => {
    router.dismissTo(globalRoutes.profile);
  }, [router]);

  const requestBack = useCallback((): boolean => {
    if (dirty) {
      setDiscardVisible(true);
      // Handled: the confirmation is now the only way out, in both directions.
      return true;
    }
    leave();
    return true;
  }, [dirty, leave]);

  // The Android hardware button, through the same decision the header's Back makes.
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', requestBack);
    return () => subscription.remove();
  }, [requestBack]);

  const save = useCallback(async () => {
    if (draft === null) {
      // Nothing was typed, so there is nothing to save. Save is disabled in this state anyway.
      return;
    }
    const checked = validateFullName(draft);
    if (!checked.ok) {
      setTouched(true);
      return;
    }
    setSavedName(null);
    // `useSubmit` swallows a second call while one is in flight, which is what stops a double tap
    // becoming two writes.
    const ok = await submit.run(async () => {
      await updateFullName(checked.value);
    });
    if (ok) {
      // The trimmed value is what was stored, so the field shows exactly what the account holds.
      setDraft(checked.value);
      setSavedName(checked.value);
      setTouched(false);
    }
    // On failure nothing is reset: the entered name stays in the field and the mapped error is
    // rendered beside it, so the user retries rather than retypes.
  }, [draft, submit, updateFullName]);

  if (status === 'signed-out') {
    // The effect above is already navigating. There is no honest personal information to draw for
    // a user who is not signed in, and a placeholder version would be a fake.
    return <View style={styles.blank} testID="personal-information-signed-out" />;
  }

  const { personal } = profileCopy;
  const nameError = touched && !validation.ok ? errorMessage(validation.problem) : undefined;
  // Null covers both "not resolved" and "not a provider we can name" — see `useAuthProviderId`.
  const providerName = authProvider === null ? null : personal.provider.names[authProvider];

  return (
    <>
      <ProfileDetailScaffold
        title={personal.title}
        onBack={requestBack}
        backLabel={profileCopy.detail.backToProfile}
        testID="personal-information"
      >
        {/* The portrait, with the truth about changing it. No upload control: there is no storage
            contract to upload to, and a disabled button would imply one exists. */}
        <ProfileDetailCard testID="personal-information-photo">
          <View style={[styles.photoRow, { columnGap: dp(12) }]}>
            <Image
              source={profileAvatar}
              style={{
                width: dp(PROFILE_LAYOUT.detail.avatar),
                height: dp(PROFILE_LAYOUT.detail.avatar),
                borderRadius: dp(PROFILE_LAYOUT.detail.avatar) / 2,
              }}
              contentFit="cover"
              accessible
              accessibilityRole="image"
              accessibilityLabel={personal.photo.accessibilityLabel}
              testID="personal-information-avatar"
            />
            <EntryAuthText
              token="caption"
              color={subscriptionColors.textSecondary}
              style={styles.photoNote}
              testID="personal-information-photo-note"
            >
              {personal.photo.note}
            </EntryAuthText>
          </View>
        </ProfileDetailCard>

        <ProfileDetailCard testID="personal-information-details">
          {/* The reserved box: an error appears inside it rather than pushing the rows below. */}
          <View
            style={{ minHeight: dp(PROFILE_LAYOUT.detail.nameFieldHeight) }}
            testID="personal-information-name-field"
          >
            {value === null ? (
              <View
                style={{ rowGap: dp(6) }}
                accessible
                accessibilityLabel={profileCopy.identity.loadingAccessibilityLabel}
                testID="personal-information-name-loading"
              >
                <ProfileSkeletonBar height={17} width={72} />
                <ProfileSkeletonBar height={48} width="100%" />
              </View>
            ) : (
              <AuthTextField
                label={personal.name.label}
                value={value}
                onChangeText={(next) => {
                  setTouched(true);
                  setSavedName(null);
                  submit.clear();
                  setDraft(next);
                }}
                placeholder={personal.name.placeholder}
                accessibilityHint={personal.name.hint}
                autoCapitalize="words"
                autoCorrect={false}
                // No `keyboardType` override: the default keyboard is the one that can type every
                // script a name might be written in.
                returnKeyType="done"
                onSubmitEditing={() => {
                  if (canSave) {
                    void save();
                  }
                }}
                // Twice the accepted length, so a paste that is too long is *rejected with a
                // message* rather than silently truncated into a different name.
                maxLength={PROFILE_NAME_MAX_LENGTH * 2}
                {...(nameError === undefined ? {} : { error: nameError })}
                testID="personal-information-name"
              />
            )}
          </View>

          <ProfileDetailRow
            label={personal.email.label}
            value={user?.email ?? profileCopy.unknownEmail}
            supporting={personal.email.supporting}
            accessibilityHint={personal.email.accessibilityHint}
            testID="personal-information-email"
          />

          {/* Rendered only for a provider the session actually reported. */}
          {providerName === null ? null : (
            <ProfileDetailRow
              label={personal.provider.label}
              value={providerName}
              testID="personal-information-provider"
            />
          )}
        </ProfileDetailCard>

        {submit.error === null ? null : (
          <AuthStatusBanner
            tone="error"
            message={submit.error.message}
            testID="personal-information-error"
          />
        )}

        {savedName === null || submit.error !== null ? null : (
          <AuthStatusBanner
            tone="success"
            message={personal.save.success}
            testID="personal-information-success"
          />
        )}

        {/* In the scrolling content rather than a pinned footer — see the keyboard note on
            `ProfileDetailScaffold`. The page is short enough that this needs no scrolling at the
            reference metrics, with or without the keyboard. */}
        <PrimaryButton
          label={personal.save.label}
          onPress={() => void save()}
          disabled={!canSave}
          loading={submit.loading}
          // States why the control is inert, so a disabled button is never a mystery.
          accessibilityHint={canSave ? personal.save.hintReady : personal.save.hintUnchanged}
          testID="personal-information-save"
        />
      </ProfileDetailScaffold>

      <ProfileDialog
        visible={discardVisible}
        title={personal.discard.title}
        body={personal.discard.body}
        // The scrim and the hardware button both keep the user editing, which is the safe outcome.
        onRequestClose={() => setDiscardVisible(false)}
        testID="personal-information-discard"
      >
        <PrimaryButton
          label={personal.discard.keep}
          onPress={() => setDiscardVisible(false)}
          testID="personal-information-discard-keep"
        />
        <SecondaryButton
          label={personal.discard.discard}
          onPress={() => {
            setDiscardVisible(false);
            leave();
          }}
          testID="personal-information-discard-confirm"
        />
      </ProfileDialog>
    </>
  );
}

/** One locked message per validation outcome. The domain decides; this only renders. */
function errorMessage(problem: ProfileNameProblem): string {
  const { errors } = profileCopy.personal.name;
  switch (problem) {
    case 'empty':
      return errors.empty;
    case 'too-long':
      return errors.tooLong(PROFILE_NAME_MAX_LENGTH);
    case 'control-characters':
      return errors.controlCharacters;
  }
}

const styles = StyleSheet.create({
  blank: {
    flex: 1,
    backgroundColor: subscriptionColors.pageBackground,
  },
  photoRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  photoNote: {
    flex: 1,
  },
});
