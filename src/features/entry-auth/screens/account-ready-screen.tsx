import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { subscriptionRoutes } from '@features/subscription/subscription-routes';

import { AuthIllustration } from '../components/auth-illustration';
import { AuthScaffold } from '../components/auth-scaffold';
import { EntryAuthText } from '../components/entry-auth-text';
import { PrimaryButton } from '../components/primary-button';
import { noorLifeAssets } from '@shared/assets/noorlife-assets';
import { accountReadyCopy, illustrationLabels } from '../entry-auth-copy';
import { entryAuthColors } from '../entry-auth-tokens';
import { useEntryAuthMetrics } from '../use-entry-auth-metrics';

/**
 * Screen 12 — Account Ready.
 *
 * `Continue to NoorLife` uses `replace`, so the whole authentication stack is dismissed: pressing
 * Back from Main Home must not return into a completed sign-up. That is the one navigation detail
 * this screen's requirement calls out explicitly.
 *
 * The success mark is drawn from primitive views rather than an icon font — the same constraint that
 * applies to every other mark on these screens.
 */
export function AccountReadyScreen() {
  const router = useRouter();
  const { dp } = useEntryAuthMetrics();
  const ring = dp(64);

  return (
    <AuthScaffold testID="account-ready-screen" contentStyle={styles.centred}>
      <View style={{ gap: dp(16) }}>
        <View style={{ height: dp(230) }}>
          <AuthIllustration
            source={noorLifeAssets.entryAuth.familyRobot}
            accessibilityLabel={illustrationLabels.familyRobot}
            testID="account-ready-artwork"
          />
        </View>

        <View
          style={[styles.check, { width: ring, height: ring, borderRadius: ring / 2 }]}
          accessible
          accessibilityRole="image"
          accessibilityLabel="Success"
          testID="account-ready-check"
        >
          <View
            style={{
              width: dp(26),
              height: dp(13),
              borderLeftWidth: 4,
              borderBottomWidth: 4,
              borderColor: entryAuthColors.onPrimary,
              transform: [{ rotate: '-45deg' }, { translateY: -dp(3) }],
            }}
          />
        </View>

        <EntryAuthText token="title" align="center" accessibilityRole="header">
          {accountReadyCopy.title}
        </EntryAuthText>
        <EntryAuthText
          token="subtitle"
          align="center"
          style={{ maxWidth: dp(280), alignSelf: 'center' }}
        >
          {accountReadyCopy.subtitle}
        </EntryAuthText>

        <PrimaryButton
          label={accountReadyCopy.submit}
          // To the plan chooser, not Main Home. Routing straight to Home from here is what
          // bypassed the subscription introduction entirely — the screen existed and simply handed
          // the user past the step it was meant to introduce. `replace`, so Back cannot reopen the
          // signup form behind a created account.
          onPress={() => router.replace(subscriptionRoutes.welcome)}
          testID="account-ready-submit"
        />
      </View>
    </AuthScaffold>
  );
}

const styles = StyleSheet.create({
  centred: {
    justifyContent: 'center',
  },
  check: {
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: entryAuthColors.success,
  },
});
