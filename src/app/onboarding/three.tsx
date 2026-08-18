import { useRouter } from 'expo-router';

import { authRoutes } from '@application/navigation/routes';
import { markOnboardingCompleted } from '@services/onboarding/onboarding-preferences';
import { FULL_RING, MedallionRing } from '@features/entry-auth/components/medallion-ring';
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
  const copy = onboardingCopy[2];

  const finish = () => {
    void markOnboardingCompleted();
    router.replace(authRoutes.welcome);
  };

  return (
    <OnboardingScreen
      step={2}
      title={copy.title}
      subtitle={copy.subtitle}
      illustration={
        /* Seven modules around the robot, Health included. This used SELECTED_RING, which carries
           six and drops Health — so the panel claiming module-specific AI was silently missing a
           module. FULL_RING is the approved seven. Noor AI is not repeated on the ring, because
           the robot at the centre already is it. */
        <MedallionRing
          size={318}
          ring={FULL_RING}
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
