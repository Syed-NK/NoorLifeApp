import { useRouter } from 'expo-router';

import { authRoutes, onboardingRoutes } from '@application/navigation/routes';
import { useAuthActions } from '@application/providers/auth-provider';
import { MedallionRing } from '@features/entry-auth/components/medallion-ring';
import { onboardingCopy } from '@features/entry-auth/entry-auth-copy';
import { OnboardingScreen } from '@features/entry-auth/screens/onboarding-screen';

/** Screen 03 — Onboarding: Every Part of Life. */
export default function Screen() {
  const router = useRouter();
  const { completeOnboarding } = useAuthActions();
  const copy = onboardingCopy[1];

  const skip = () => {
    void completeOnboarding();
    router.replace(authRoutes.welcome);
  };

  return (
    <OnboardingScreen
      step={1}
      title={copy.title}
      subtitle={copy.subtitle}
      illustration={<MedallionRing size={318} testID="onboarding-two-ring" />}
      primaryLabel={copy.primaryLabel}
      onPrimary={() => router.push(onboardingRoutes.three)}
      onSkip={skip}
      testID="onboarding-two"
    />
  );
}
