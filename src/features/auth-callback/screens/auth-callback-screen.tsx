import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { authRoutes } from '@application/navigation/routes';
import {
  useAuthCallback,
  useAuthCallbackActions,
  type CapturedCallback,
} from '@application/providers/auth-callback-provider';
import { AuthHeader } from '@features/entry-auth/components/auth-header';
import { AuthScaffold } from '@features/entry-auth/components/auth-scaffold';
import { AuthStatusBanner } from '@features/entry-auth/components/auth-status-banner';
import { EntryAuthText } from '@features/entry-auth/components/entry-auth-text';
import { PrimaryButton } from '@features/entry-auth/components/primary-button';
import { SecondaryButton } from '@features/entry-auth/components/secondary-button';
import { entryAuthColors } from '@features/entry-auth/entry-auth-tokens';
import { useEntryAuthMetrics } from '@features/entry-auth/use-entry-auth-metrics';
import type {
  AuthCallbackErrorCode,
  AuthCallbackPort,
} from '@services/auth/auth-callback.contract';
import { authCallbackPort } from '@services/auth/auth-callback.service';

import { authCallbackCopy } from '../auth-callback-copy';
import { SET_NEW_PASSWORD_ROUTE } from '../auth-callback-routes';

/**
 * `/auth/callback` — the one screen an emailed NoorLife link lands on.
 *
 * ── What is on screen, and what is deliberately not ─────────────────────────
 * A state and an action. Never the authorization code, never a token, never the callback URL, never
 * the server's `error_description` — the parser discards that string before this screen exists, and
 * every message here comes from `auth-callback-copy.ts`. A "quote this reference to support"
 * affordance was considered and rejected: the only reference available is the code itself, and putting
 * it on screen puts it in a screenshot.
 *
 * ── Consumed exactly once ───────────────────────────────────────────────────
 * The callback is claimed from the provider inside a mount effect guarded by a ref, and `claim()`
 * clears the provider's copy synchronously. Two mounts in one commit, a re-render mid-exchange, and a
 * duplicated warm delivery therefore all produce one exchange. The service holds the second half of
 * the same guard, and Supabase's own single-use verifier holds the third.
 *
 * ── Geometry ────────────────────────────────────────────────────────────────
 * One card in a fixed-height slot, so the processing, success and failure states occupy the same box
 * and the screen does not jump as it resolves. The action row is always present and always the same
 * height; only its labels change.
 *
 * ── Retry is offered only where retrying could work ─────────────────────────
 * `offline` and `server-error` leave the link unused at the server, so a retry is honest. Every other
 * failure has consumed or invalidated it, and a Try Again that could only fail again is worse than no
 * button — those states offer a new link instead.
 */

/** Failures where the link is still good and the fault was the connection. */
const RETRYABLE: readonly AuthCallbackErrorCode[] = ['offline', 'server-error'];

type Phase =
  | { readonly name: 'processing' }
  | { readonly name: 'signed-in'; readonly email: string | null; readonly pending: string | null }
  | { readonly name: 'recovery' }
  | { readonly name: 'failed'; readonly code: AuthCallbackErrorCode };

export function AuthCallbackScreen({
  port = authCallbackPort,
}: {
  readonly port?: AuthCallbackPort;
} = {}) {
  const router = useRouter();
  const { dp } = useEntryAuthMetrics();
  const { pending, resolved } = useAuthCallback();
  const { claim, grantRecovery, takeDestination } = useAuthCallbackActions();
  const copy = authCallbackCopy.callback;

  const [phase, setPhase] = useState<Phase>({ name: 'processing' });

  /**
   * The claim guard.
   *
   * A ref rather than state, because two effects in the same commit both run before React re-renders
   * — so a state flag would still be false for the second one. `claim()` is itself synchronous and
   * ref-backed on the provider's side, so this is the outer of two guards rather than the only one.
   */
  const claimed = useRef(false);
  /** The callback this screen took, kept so Try Again can re-run the same one. */
  const held = useRef<CapturedCallback | null>(null);
  /**
   * Whether the password screen has already been opened.
   *
   * A ref rather than state: the guard has to hold *within* the same pass that sets the phase, and a
   * state flag would still read false for a second call in the same tick.
   */
  const navigatedToRecovery = useRef(false);

  /**
   * Maps one claim outcome to one phase.
   *
   * `null` is a legitimate outcome and is handled here rather than in the effect below. Two reasons,
   * and the second is the load-bearing one: it keeps *every* state transition for this screen in one
   * function, and it keeps the effect free of a synchronous `setState` — which React's own guidance
   * (and `react-hooks/set-state-in-effect`) rules out, because a set during the effect pass is a
   * cascading render rather than a synchronisation with an external system.
   */
  const run = useCallback(
    async (captured: CapturedCallback | null) => {
      /**
       * One yield before any state is set, and it is not a formality.
       *
       * This function is called from a mount effect. A `setPhase` reached synchronously from there is a
       * cascading render inside the effect pass — what React's own guidance (and
       * `react-hooks/set-state-in-effect`) rules out, because the commit that scheduled the effect has
       * to be thrown away and redone. Yielding once puts every transition below on the far side of that
       * pass, which is where a reaction to an asynchronous read belongs.
       *
       * Nothing flickers: `processing` is already the initial state, so the first thing the user sees is
       * the same either way. The retry path calls this from a press handler, where a microtask is
       * imperceptible.
       */
      await Promise.resolve();

      if (captured === null) {
        /**
         * Nothing to claim.
         *
         * Either the route was opened directly, or a previous mount already took it. Both are the same
         * thing from here: there is no link to confirm, and the screen says so rather than sitting on a
         * spinner for ever.
         */
        setPhase({ name: 'failed', code: 'invalid-link' });
        return;
      }

      setPhase({ name: 'processing' });

      if (captured.parsed.kind === 'rejected') {
        // Refused before any network call. Nothing was sent and nothing was consumed.
        setPhase({ name: 'failed', code: captured.parsed.code });
        return;
      }
      if (captured.parsed.kind === 'error') {
        // GoTrue reported the failure itself — an expired recovery link, most often.
        setPhase({ name: 'failed', code: captured.parsed.code });
        return;
      }
      if (captured.parsed.kind === 'unrelated') {
        // The provider never stores these. Handled so the union stays exhaustive rather than assumed.
        setPhase({ name: 'failed', code: 'invalid-link' });
        return;
      }

      const outcome = await port.process(captured.parsed);
      if (outcome.status === 'failed') {
        setPhase({ name: 'failed', code: outcome.code });
        return;
      }
      if (outcome.status === 'recovery-ready') {
        /**
         * The grant is recorded and the password screen is opened in the same pass.
         *
         * ── Why this is no longer a press ───────────────────────────────────────
         * It used to render a success banner with a Continue button and wait. That left the one
         * screen in the flow whose *only* way forward was a single tap — and a tap that fails to
         * navigate, for any reason, is indistinguishable from an app that has stopped working. It was
         * reported inert on a release device, and a control that is enabled but does nothing is worse
         * than no control at all.
         *
         * There is nothing for the user to decide here. The exchange has already succeeded, the grant
         * is already minted, and the only destination is the password form. So the callback screen is
         * transient by construction: processing → exchange → replaced.
         *
         * ── Order, and why it is safe ───────────────────────────────────────────
         * `grantRecovery` and `replace` are both called from this one continuation, so React batches
         * them into a single commit: the provider's `recovery` is set *before* the password screen
         * mounts and reads it. Setting the phase as well keeps the success state honest if the
         * navigation somehow does not take — the user sees a confirmed link rather than a spinner
         * that never ends, and there is no button offering an action that cannot happen.
         *
         * ── `replace`, and exactly once ─────────────────────────────────────────
         * `replace` so Back cannot return to a consumed callback. The ref makes it once even though
         * `run` is also reachable from Try Again — a second `replace` onto the same route would remount
         * the password screen and throw away anything already typed into it.
         */
        grantRecovery({ userId: outcome.userId });
        setPhase({ name: 'recovery' });
        if (!navigatedToRecovery.current) {
          navigatedToRecovery.current = true;
          router.replace(SET_NEW_PASSWORD_ROUTE);
        }
        return;
      }
      setPhase({ name: 'signed-in', email: outcome.email, pending: outcome.pendingEmail });
    },
    [grantRecovery, port, router],
  );

  useEffect(() => {
    if (claimed.current) {
      return;
    }
    /**
     * Nothing is concluded until the provider's cold-start read has settled.
     *
     * `pending === null` before then means "we do not know yet", not "there is no link" —
     * `Linking.getInitialURL()` is a promise, and this screen mounts in the same commit as the provider
     * when it is rendered directly. Claiming early would take an empty answer and show an invalid-link
     * state for a perfectly good launch URL. `resolved` is the provider's explicit signal that the
     * question now has an answer; a pending callback is enough on its own, which is the warm case.
     */
    if (!resolved && pending === null) {
      return;
    }
    // Marked before claiming, so a second effect pass in the same commit cannot claim again even
    // though `claim()` would already have returned null for it.
    claimed.current = true;
    const captured = claim();
    held.current = captured;
    /**
     * The rule is suppressed here, and only here, because it cannot see the boundary that satisfies it.
     *
     * `react-hooks/set-state-in-effect` traces into `run` and finds `setPhase`, but every one of those
     * calls is behind `await Promise.resolve()` — see the note at the top of `run` — so none of them is
     * reached during the effect pass. The linter does not model the await, so it reports a cascading
     * render that does not happen.
     *
     * The shape is also precisely the one the rule's own guidance permits: this subscribes to an external
     * system — the OS deep-link holder, read through the provider — and sets state in the continuation
     * that runs when that read has an answer. Mount is the only trigger available, because a cold-start
     * link is already waiting by the time this screen exists.
     */
    // eslint-disable-next-line react-hooks/set-state-in-effect -- every setState in `run` is behind an await.
    void run(captured);
  }, [claim, pending, resolved, run]);

  /**
   * Where a confirmed session goes next.
   *
   * The entry gate, and only the entry gate. `startup-machine.ts` already holds the one authoritative
   * post-auth decision — including the rule that a signed-in account with no recorded plan choice
   * goes to the plan chooser rather than Main Home — and a second decision here is exactly how a
   * confirmed signup would come to bypass it.
   *
   * A remembered destination is honoured only when it survived sanitizing, and it is still subject to
   * every gate that route normally has. `replace` rather than `push`, so Back cannot return to a
   * consumed callback.
   */
  const continueOn = useCallback(() => {
    const destination = takeDestination();
    /**
     * The cast is the boundary between a *checked* path and a *typed* route.
     *
     * `sanitizeDestination` already proved the value is an app-internal path on the resumable
     * allow-list, which is the security question. Expo Router's generated `Href` is a literal union it
     * can only build from statically-written route strings, so a value that arrived at runtime cannot
     * satisfy it however safe it is. `'/'` is the entry gate, and every route in
     * `RESUMABLE_ROUTE_PREFIXES` is real — `auth-callback-routes.test.tsx` asserts that against the
     * router's own contract, which is the check this cast gives up.
     */
    router.replace((destination ?? '/') as Parameters<typeof router.replace>[0]);
  }, [router, takeDestination]);

  const requestNewLink = useCallback(() => {
    router.replace(authRoutes.forgotPassword);
  }, [router]);

  const backToSignIn = useCallback(() => {
    router.replace(authRoutes.signIn);
  }, [router]);

  const retry = useCallback(() => {
    const captured = held.current;
    if (captured === null) {
      return;
    }
    void run(captured);
  }, [run]);

  return (
    <AuthScaffold testID="auth-callback-screen">
      <AuthHeader
        onBack={backToSignIn}
        title={copy.title}
        subtitle={copy.processingSupporting}
        testID="auth-callback-header"
      />

      {/* A fixed-height slot, so every state occupies the same box and the page does not jump. */}
      <View style={[styles.slot, { minHeight: dp(180), rowGap: dp(12) }]} testID="auth-callback-slot">
        {phase.name === 'processing' ? (
          <View style={{ rowGap: dp(12) }} testID="auth-callback-processing">
            <ActivityIndicator
              color={entryAuthColors.primary}
              testID="auth-callback-processing-spinner"
            />
            {/*
              Announced, not merely drawn. The whole screen is a wait, and a screen reader that only
              saw a spinner would be told nothing at all.
            */}
            <EntryAuthText
              token="body"
              align="center"
              accessibilityRole="alert"
              accessibilityLiveRegion="polite"
              accessibilityLabel={copy.processing}
              testID="auth-callback-processing-label"
            >
              {copy.processing}
            </EntryAuthText>
          </View>
        ) : phase.name === 'recovery' ? (
          <View style={{ rowGap: dp(12) }} testID="auth-callback-recovery">
            <AuthStatusBanner
              tone="success"
              message={copy.recoveryTitle}
              testID="auth-callback-recovery-banner"
            />
            <EntryAuthText token="body" align="center" color={entryAuthColors.textSecondary}>
              {copy.recoverySupporting}
            </EntryAuthText>
          </View>
        ) : phase.name === 'signed-in' ? (
          <View style={{ rowGap: dp(12) }} testID="auth-callback-signed-in">
            <AuthStatusBanner
              tone="success"
              message={
                phase.pending !== null
                  ? copy.emailPendingTitle
                  : phase.email !== null
                    ? copy.emailChangedTitle
                    : copy.signupTitle
              }
              testID="auth-callback-signed-in-banner"
            />
            {/*
              Every address below is read from the refreshed `auth.users`, never from the link. An
              address on a callback URL is an untrusted claim, and rendering it as the account's
              address is the one mistake the email-change flow cannot make.
            */}
            <EntryAuthText
              token="body"
              align="center"
              color={entryAuthColors.textSecondary}
              testID="auth-callback-signed-in-detail"
            >
              {phase.pending !== null
                ? copy.emailPendingFor(phase.pending)
                : phase.email !== null
                  ? copy.emailChangedFor(phase.email)
                  : copy.signupSupporting}
            </EntryAuthText>
            {phase.pending !== null && phase.email !== null ? (
              <EntryAuthText
                token="caption"
                align="center"
                color={entryAuthColors.textSecondary}
                testID="auth-callback-signed-in-current"
              >
                {copy.emailPendingCurrent(phase.email)}
              </EntryAuthText>
            ) : null}
          </View>
        ) : (
          <View style={{ rowGap: dp(12) }} testID="auth-callback-error">
            <AuthStatusBanner
              tone={phase.code === 'offline' ? 'info' : 'error'}
              message={copy.errorTitles[phase.code]}
              testID="auth-callback-error-banner"
            />
            <EntryAuthText
              token="body"
              align="center"
              color={entryAuthColors.textSecondary}
              testID="auth-callback-error-detail"
            >
              {copy.errors[phase.code]}
            </EntryAuthText>
          </View>
        )}
      </View>

      {/* The action row. Always present and always the same height; only the labels change. */}
      <View style={{ rowGap: dp(10) }} testID="auth-callback-actions">
        {/*
          `recovery` shows no action at all.

          The password screen is opened automatically the moment the exchange succeeds, so this state
          is not something the user is meant to act on — and offering a button here is what produced
          the reported "enabled but does nothing" screen. If the navigation has taken, this is never
          seen; if it somehow has not, an honest success message is better than a control that cannot
          deliver what it promises.
        */}
        {phase.name === 'processing' || phase.name === 'recovery' ? null : phase.name ===
          'signed-in' ? (
          <PrimaryButton
            label={copy.continue}
            onPress={continueOn}
            testID="auth-callback-continue"
          />
        ) : (
          <>
            {RETRYABLE.includes(phase.code) ? (
              /* The link is still unused at the server, so retrying can genuinely succeed. */
              <PrimaryButton label={copy.retry} onPress={retry} testID="auth-callback-retry" />
            ) : (
              <PrimaryButton
                label={copy.requestNewLink}
                onPress={requestNewLink}
                testID="auth-callback-request-link"
              />
            )}
            <SecondaryButton
              label={copy.backToSignIn}
              onPress={backToSignIn}
              testID="auth-callback-back"
            />
          </>
        )}
      </View>
    </AuthScaffold>
  );
}

const styles = StyleSheet.create({
  slot: {
    alignItems: 'stretch',
    justifyContent: 'center',
  },
});
