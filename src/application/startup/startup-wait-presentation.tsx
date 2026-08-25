import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { StartupResolvingNotice } from '@features/entry-auth/components/startup-resolving-notice';
import { neutralColors } from '@ds/tokens';

import { useStartupPresentation } from './startup-presentation-provider';

/**
 * **What a launch path with no splash behind it shows while it waits** — issue #58.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Why this is not simply the notice ──────────────────────────────────────
 * `StartupResolvingNotice` is unpositioned and unsized on purpose: on the entry gate it is laid out
 * by the gate's wrapper, underneath the design-locked splash, so it cannot disturb locked geometry.
 * A deep-linked route has no such wrapper — the authentication boundary is the outermost thing in
 * the tree — so something has to give the notice a surface. This is that surface and nothing more.
 *
 * ── Nothing before the ceiling ─────────────────────────────────────────────
 * Below the ceiling this renders `null`, which is exactly what the boundary rendered before. That is
 * deliberate: an ordinary launch resolves in well under a second, and a spinner thrown up for a few
 * hundred milliseconds is a flash of noise rather than information. The approved behaviour for a
 * fast launch is the native splash handing off to the destination with nothing in between, and this
 * does not change it.
 *
 * At or past the ceiling every waiting path says the same true thing, whether it started at the
 * launcher or at a link.
 *
 * ── It decides nothing ────────────────────────────────────────────────────
 * It reads a clock and renders. It does not read the session, the receipt, the account journey, the
 * recovery marker or the entitlement; it holds no state, starts no timer, issues no read and
 * navigates nowhere. It cannot admit anyone to anything — it is rendered *instead of* `children`, on
 * a branch the boundary had already decided to withhold them on, so there is no path by which
 * showing this reveals protected content.
 *
 * Navigating from here would be the serious mistake, and it is the one #31 removed: a progress
 * notice that redirected would be a stopwatch issuing a verdict again, telling a signed-in user on a
 * slow link that there is nobody signed in.
 * ═══════════════════════════════════════════════════════════════════════════
 */
export function StartupWaitPresentation({ testID }: { readonly testID?: string }) {
  const { pastCeiling } = useStartupPresentation();
  const insets = useSafeAreaInsets();

  if (!pastCeiling) {
    return null;
  }

  return (
    <View
      style={[
        styles.surface,
        /*
          Insets rather than a `SafeAreaView`: the notice is centred, so only the extremes matter,
          and padding both ends keeps it clear of a notch and a gesture bar without the component
          claiming to be a screen. Measured at font scale 1.5 the notice is two lines and still sits
          well inside these bounds.
        */
        { paddingTop: insets.top, paddingBottom: insets.bottom },
      ]}
      testID={testID ?? 'startup-wait-presentation'}
    >
      <StartupResolvingNotice />
    </View>
  );
}

const styles = StyleSheet.create({
  surface: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    /*
      The same canvas the root layout paints, so this reads as the app still starting rather than as
      a panel over a screen. Explicit rather than transparent: on a deep link there is nothing
      underneath, and a transparent surface would show whatever the navigator's background happens
      to be.
    */
    backgroundColor: neutralColors.canvas,
  },
});
