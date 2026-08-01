import { useRouter } from 'expo-router';

import { authRoutes, onboardingRoutes } from '@application/navigation/routes';
import { markOnboardingCompleted } from '@services/onboarding/onboarding-preferences';
import { MedallionRing, ORBIT_RING } from '@features/entry-auth/components/medallion-ring';
import { onboardingCopy } from '@features/entry-auth/entry-auth-copy';
import { OnboardingScreen } from '@features/entry-auth/screens/onboarding-screen';

/** Screen 03 — Onboarding: Every Part of Life. */
export default function Screen() {
  const router = useRouter();
  const copy = onboardingCopy[1];

  const skip = () => {
    void markOnboardingCompleted();
    router.replace(authRoutes.welcome);
  };

  return (
    <OnboardingScreen
      step={1}
      title={copy.title}
      subtitle={copy.subtitle}
      illustration={
        /* All eight product identities as equals, orbiting an empty centre. The approved PNGs,
           the same files Main Home uses — no icon font, no emoji, no square tiles. */
        <MedallionRing size={318} ring={ORBIT_RING} centre={null} testID="onboarding-two-ring" />
      }
      primaryLabel={copy.primaryLabel}
      onPrimary={() => router.push(onboardingRoutes.three)}
      onSkip={skip}
      testID="onboarding-two"
    />
  );
}
