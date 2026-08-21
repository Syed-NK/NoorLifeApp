import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { entryAuthColors } from '../entry-auth-tokens';
import { EntryAuthText } from './entry-auth-text';

/**
 * **What a slow launch says once the brand has had its moment** — issue #31.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Why this exists at all ─────────────────────────────────────────────────
 * Past the presentation ceiling the startup machine reports `still_resolving` and, deliberately,
 * concludes nothing. Something has to be on screen for that. The two things it replaced were both
 * wrong in different directions: the previous behaviour navigated to Authentication Options, telling a
 * signed-in user they were signed out; leaving only the branded splash up says nothing at all, which is
 * the blank-interval half of the same issue.
 *
 * ── What it deliberately does not say ──────────────────────────────────────
 * Nothing about *who* the user is. No name, no greeting, no email, no avatar, no account state, no
 * "welcome back". At the moment this renders the app does not know any of that — that is precisely why
 * it is rendering — and a reassuring guess would be the same class of lie as the redirect it replaces.
 * It also offers no action: there is nothing the user can usefully do, and a "Try again" that re-ran a
 * resolution already in flight would be a retry dressed as a control.
 *
 * So the copy is about the *app's* state, not the user's, and it is the honest reading of that state:
 * something is still being fetched, and nothing has gone wrong yet.
 *
 * ── Why it sits below the splash rather than replacing it ──────────────────
 * `splash-screen.tsx` is design-locked and takes no props. This is additive: the approved launch
 * surface keeps rendering exactly as it does, and this notice appears underneath it only after the
 * ceiling. So the ordinary launch — the overwhelming majority — is pixel-identical to before, and the
 * only users who ever see this are the ones who would previously have been ejected to a sign-in screen.
 *
 * Colours and type come from `entry-auth-tokens`, the same approved set the authentication screens use,
 * so nothing new is introduced to the launch palette.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * The message, as a constant so a test can assert the absence of anything account-shaped.
 *
 * Present tense and unfinished rather than apologetic: at ten seconds nothing has failed, and copy
 * that says "something went wrong" would be as untrue as the redirect.
 */
export const STARTUP_RESOLVING_MESSAGE = 'Still getting things ready…';

export function StartupResolvingNotice({ testID }: { readonly testID?: string }) {
  return (
    <View
      style={styles.container}
      testID={testID ?? 'startup-resolving-notice'}
      /*
        One live region for the pair, announced politely.

        `polite` rather than `assertive`: this is a progress update, and interrupting whatever a screen
        reader is saying for it would be louder than the information deserves. The spinner is marked
        `none` and the label carries the whole message, so the state is announced once rather than as
        an unlabelled busy indicator plus a separate line.
      */
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={STARTUP_RESOLVING_MESSAGE}
      accessibilityLiveRegion="polite"
    >
      <ActivityIndicator
        color={entryAuthColors.textSecondary}
        accessibilityElementsHidden
        importantForAccessibility="no"
      />
      <EntryAuthText token="body" color={entryAuthColors.textSecondary} style={styles.message}>
        {STARTUP_RESOLVING_MESSAGE}
      </EntryAuthText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    /*
      Unpositioned and unsized on purpose: it is laid out by the entry gate's wrapper rather than
      claiming a place of its own, so it cannot disturb the locked splash geometry above it.
    */
    rowGap: 8,
    paddingBottom: 24,
    paddingHorizontal: 24,
  },
  message: {
    textAlign: 'center',
  },
});
