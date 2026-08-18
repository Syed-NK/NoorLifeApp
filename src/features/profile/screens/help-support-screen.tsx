import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { View } from 'react-native';

import { globalRoutes } from '@application/navigation/routes';
import { EntryAuthText } from '@features/entry-auth/components/entry-auth-text';
import { PrimaryButton } from '@features/entry-auth/components/primary-button';
import { SecondaryButton } from '@features/entry-auth/components/secondary-button';
import { useEntryAuthMetrics } from '@features/entry-auth/use-entry-auth-metrics';
import { SubscriptionStateBanner } from '@features/subscription/components/subscription-states';
import { subscriptionColors } from '@features/subscription/subscription-tokens';
import {
  formatDiagnostics,
  readAppDiagnostics,
} from '@services/diagnostics/app-diagnostics.service';
import {
  copyToClipboard,
  openEmailDraft,
  openExternalUrl,
  type LinkOutcome,
} from '@services/links/external-link.service';

import { ProfileDetailCard, ProfileDetailRow } from '../components/profile-detail-card';
import { ProfileDetailScaffold } from '../components/profile-detail-scaffold';
import { ProfileExpandableRow } from '../components/profile-expandable-row';
import { helpCopy } from '../help-copy';
import { helpFaq } from '../help-faq';
import { profileCopy } from '../profile-copy';

/**
 * Help & Support — `/profile/help`.
 *
 * ── What is real here ───────────────────────────────────────────────────────
 * All of it, which is unusual for this phase. Six answers derived from the product rules the app
 * actually enforces; a mail draft to a real monitored address; two published policy URLs opened in
 * the in-app browser; and a version and build read from the installed package rather than typed
 * into a constant.
 *
 * ── What is deliberately not here ───────────────────────────────────────────
 * A ticket form. "Report a Problem" opens the user's own mail application with a draft they can
 * read, edit and choose to send — nothing is posted, because there is no support backend, and a
 * form that appeared to file a ticket would be the most damaging fake on this screen. The copy
 * says so in a sentence rather than leaving it to be discovered.
 *
 * ── No Help control in the header ───────────────────────────────────────────
 * `ProfileDetailScaffold` takes `onHelp` optionally and this screen does not pass it, so the right
 * slot renders as an equally sized empty box. That keeps the title on the header's true centre
 * while removing a control whose only destination would be the screen it is already on — a loop
 * that is confusing to see and worse to hear announced.
 *
 * ── `__DEV__` ───────────────────────────────────────────────────────────────
 * The development-build answer is added by `helpFaq` only when the flag is set, and that branch is
 * additionally guarded by `__DEV__` inside `helpFaq` itself — so the wording about mock purchases
 * is not merely unrendered in a release build, it is not compiled into the bundle. Searching the
 * built `index.android.bundle` for it is the check, and it is recorded in the capture README.
 */
export function HelpSupportScreen() {
  const router = useRouter();
  const { dp } = useEntryAuthMetrics();

  const faq = useMemo(() => helpFaq({ developmentNotes: __DEV__ }), []);
  const diagnostics = useMemo(() => readAppDiagnostics(), []);
  const diagnosticsText = useMemo(() => formatDiagnostics(diagnostics), [diagnostics]);

  /** One answer open at a time — six open answers is most of a screen of prose. */
  const [openQuestion, setOpenQuestion] = useState<string | null>(null);

  const [mailOutcome, setMailOutcome] = useState<LinkOutcome | null>(null);
  const [emailCopied, setEmailCopied] = useState(false);
  const [failedLink, setFailedLink] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [diagnosticsCopied, setDiagnosticsCopied] = useState<boolean | null>(null);

  const composeMail = useCallback(async (subject: string, body: string) => {
    setMailOutcome(null);
    setEmailCopied(false);
    // The body is the diagnostics block and nothing else — see `app-diagnostics.service.ts`
    // for the four fields it may contain, and for why it is an allow-list.
    const outcome = await openEmailDraft({
      to: helpCopy.contact.emailAddress,
      subject,
      body,
    });
    setMailOutcome(outcome);
  }, []);

  const openLink = useCallback(async (url: string) => {
    setFailedLink(null);
    setLinkCopied(false);
    const outcome = await openExternalUrl(url);
    if (outcome !== 'opened') {
      setFailedLink(url);
    }
  }, []);

  const copy = helpCopy;

  return (
    <ProfileDetailScaffold
      title={copy.title}
      onBack={() => router.dismissTo(globalRoutes.profile)}
      backLabel={profileCopy.detail.backToProfile}
      testID="help-support"
    >
      {/* ── Help Center ──────────────────────────────────────────────────── */}
      <ProfileDetailCard heading={copy.faq.heading} testID="help-support-faq">
        {faq.map((entry) => (
          <ProfileExpandableRow
            key={entry.key}
            question={entry.question}
            answer={entry.answer}
            expanded={openQuestion === entry.key}
            onToggle={() => setOpenQuestion(openQuestion === entry.key ? null : entry.key)}
            expandHint={copy.faq.expandHint}
            collapseHint={copy.faq.collapseHint}
            testID={entry.testID}
          />
        ))}
      </ProfileDetailCard>

      {/* ── Contact Support ──────────────────────────────────────────────── */}
      <ProfileDetailCard heading={copy.contact.heading} testID="help-support-contact">
        <ProfileDetailRow
          label={copy.contact.emailLabel}
          value={copy.contact.emailAddress}
          supporting={copy.contact.backendNote}
          testID="help-support-email"
        />

        <EntryAuthText
          token="caption"
          color={subscriptionColors.textSecondary}
          testID="help-support-diagnostics-note"
        >
          {copy.contact.diagnosticsNote}
        </EntryAuthText>

        <View style={{ rowGap: dp(8) }}>
          <PrimaryButton
            label={copy.contact.emailSupport}
            onPress={() => void composeMail(copy.contact.emailSubject, diagnosticsText)}
            accessibilityHint={copy.contact.emailSupportHint}
            testID="help-support-email-action"
          />
          <SecondaryButton
            label={copy.contact.reportProblem}
            // The same diagnostics block, under a line asking for what happened. One composer, so
            // the two drafts cannot end up carrying different information.
            onPress={() =>
              void composeMail(
                copy.contact.reportSubject,
                `${copy.contact.reportIntro}\n\n${diagnosticsText}`,
              )
            }
            testID="help-support-report-action"
          />
        </View>

        {/* No mail application, or the composer failed. Either way the address is shown so the
            user can reach us from another device rather than being left with a dead button. */}
        {mailOutcome === 'no-handler' || mailOutcome === 'failed' ? (
          <View style={{ rowGap: dp(6) }} testID="help-support-mail-fallback">
            <EntryAuthText token="caption" color={subscriptionColors.warning}>
              {`${mailOutcome === 'no-handler' ? copy.contact.noMailApp : copy.contact.failed} ${copy.contact.emailAddress}`}
            </EntryAuthText>
            <SecondaryButton
              label={emailCopied ? copy.contact.copied : copy.contact.copyEmail}
              onPress={() => {
                void copyToClipboard(copy.contact.emailAddress).then(setEmailCopied);
              }}
              testID="help-support-copy-email"
            />
          </View>
        ) : null}
      </ProfileDetailCard>

      {/* ── Legal ────────────────────────────────────────────────────────── */}
      <ProfileDetailCard heading={copy.legal.heading} testID="help-support-legal">
        <SecondaryButton
          label={copy.legal.privacy}
          onPress={() => void openLink(copy.legal.privacyUrl)}
          testID="help-support-privacy"
        />
        <SecondaryButton
          label={copy.legal.terms}
          onPress={() => void openLink(copy.legal.termsUrl)}
          testID="help-support-terms"
        />

        {failedLink === null ? null : (
          <View style={{ rowGap: dp(6) }} testID="help-support-link-failed">
            <SubscriptionStateBanner
              tone="warning"
              message={copy.legal.linkFailed}
              testID="help-support-link-failed-banner"
            />
            <SecondaryButton
              label={copy.legal.retry}
              onPress={() => void openLink(failedLink)}
              testID="help-support-link-retry"
            />
            <SecondaryButton
              label={linkCopied ? copy.legal.copied : copy.legal.copyLink}
              onPress={() => {
                void copyToClipboard(failedLink).then(setLinkCopied);
              }}
              testID="help-support-copy-link"
            />
          </View>
        )}
      </ProfileDetailCard>

      {/* ── About NoorLife ───────────────────────────────────────────────── */}
      <ProfileDetailCard heading={copy.about.heading} testID="help-support-about">
        <ProfileDetailRow
          label={copy.about.versionLabel}
          value={diagnostics.appVersion}
          testID="help-support-version"
        />
        <ProfileDetailRow
          label={copy.about.buildLabel}
          value={diagnostics.buildNumber}
          testID="help-support-build"
        />
        <ProfileDetailRow
          label={copy.about.platformLabel}
          value={`${diagnostics.platform} ${diagnostics.osVersion}`}
          testID="help-support-platform"
        />

        <SecondaryButton
          label={copy.about.copyDiagnostics}
          onPress={() => {
            void copyToClipboard(diagnosticsText).then(setDiagnosticsCopied);
          }}
          testID="help-support-copy-diagnostics"
        />

        {diagnosticsCopied === null ? null : (
          <EntryAuthText
            token="caption"
            color={
              diagnosticsCopied ? subscriptionColors.textSecondary : subscriptionColors.warning
            }
            testID="help-support-copy-diagnostics-result"
          >
            {diagnosticsCopied ? copy.about.copied : copy.about.copyFailed}
          </EntryAuthText>
        )}

        <SecondaryButton
          label={copy.about.website}
          onPress={() => void openLink(copy.about.websiteUrl)}
          testID="help-support-website"
        />

        <EntryAuthText
          token="caption"
          color={subscriptionColors.textSecondary}
          testID="help-support-copyright"
        >
          {copy.about.copyright(new Date().getFullYear())}
        </EntryAuthText>
      </ProfileDetailCard>
    </ProfileDetailScaffold>
  );
}
