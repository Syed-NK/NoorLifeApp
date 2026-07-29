import { useRouter } from 'expo-router';

import { authRoutes } from '@application/navigation/routes';
import { useAuthActions } from '@application/providers/auth-provider';
import { MedallionRing, SELECTED_RING } from '@features/entry-auth/components/medallion-ring';
import { onboardingCopy } from '@features/entry-auth/entry-auth-copy';
import { OnboardingScreen } from '@features/entry-auth/screens/onboarding-screen';

/**
 * Screen 04 — Onboarding: AI That Understands.
 *
 * The final panel: a single full-width `Get Started`, no Skip, matching the reference. It completes
 * onboarding and *replaces* the stack with Authentication Options, so Back cannot return into a
 * flow that has been finished.
 *
 * The approved `privacy-shield.png` now overlays the robot's lower left, as the reference shows —
 * it was reported missing in the previous pass and has since been supplied.
 *
 */
export default function Screen() {
  const router = useRouter();
  const { completeOnboarding } = useAuthActions();
  const copy = onboardingCopy[2];

  const finish = () => {
    void completeOnboarding();
    router.replace(authRoutes.welcome);
  };

  return (
    <OnboardingScreen
      step={2}
      title={copy.title}
      subtitle={copy.subtitle}
      illustration={
        <MedallionRing
          size={318}
          ring={SELECTED_RING}
          withPrivacyShield
          testID="onboarding-three-ring"
        />
      }
      primaryLabel={copy.primaryLabel}
      onPrimary={finish}
      testID="onboarding-three"
    />
  );
}
