import { useRouter } from 'expo-router';

import { authRoutes, onboardingRoutes } from '@application/navigation/routes';
import { useAuthActions } from '@application/providers/auth-provider';
import { AuthIllustration } from '@features/entry-auth/components/auth-illustration';
import { noorLifeAssets } from '@shared/assets/noorlife-assets';
import { illustrationLabels, onboardingCopy } from '@features/entry-auth/entry-auth-copy';
import { OnboardingScreen } from '@features/entry-auth/screens/onboarding-screen';

/**
 * Screen 02 — Onboarding: Family in Sync.
 *
 * Skip marks onboarding complete and *replaces* the stack with Authentication Options, so Back
 * cannot walk into a flow the user has just opted out of. Next only pushes, leaving Back to step
 * back through the panels as the workflow diagram shows.
 */
export default function Screen() {
  const router = useRouter();
  const { completeOnboarding } = useAuthActions();
  const copy = onboardingCopy[0];

  const skip = () => {
    // Fire-and-forget: the flag is a convenience, and a storage failure must not block the user
    // from leaving onboarding. session-storage swallows its own errors for the same reason.
    void completeOnboarding();
    router.replace(authRoutes.welcome);
  };

  return (
    <OnboardingScreen
      step={0}
      title={copy.title}
      subtitle={copy.subtitle}
      illustration={
        <AuthIllustration
          source={noorLifeAssets.entryAuth.familyRobot}
          accessibilityLabel={illustrationLabels.familyRobot}
          testID="onboarding-one-artwork"
        />
      }
      primaryLabel={copy.primaryLabel}
      onPrimary={() => router.push(onboardingRoutes.two)}
      onSkip={skip}
      testID="onboarding-one"
    />
  );
}
