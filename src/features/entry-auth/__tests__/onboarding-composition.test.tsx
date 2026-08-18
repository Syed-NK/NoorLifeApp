import { render, screen } from '@testing-library/react-native';

import OnboardingOne from '@app/onboarding/one';
import OnboardingTwo from '@app/onboarding/two';
import OnboardingThree from '@app/onboarding/three';
import { AuthProvider } from '@application/providers/auth-provider';
import { FULL_RING, ORBIT_RING, SELECTED_RING } from '../components/medallion-ring';
import { ENTRY_STEP_COUNT } from '../entry-steps';
import { onboardingCopy } from '../entry-auth-copy';

/**
 * The three onboarding panels and what each one is made of.
 *
 * Composition is asserted from the ring definitions as well as the rendered output: a missing
 * pictogram is invisible in a screenshot unless you already know to count, which is exactly how
 * panel 3 shipped without Health.
 */

const MODULES_ON_PANEL_THREE = [
  'faith',
  'health',
  'planner',
  'finance',
  'learning',
  'family',
  'goals',
] as const;

describe('there are exactly three panels', () => {
  it('has three sets of copy and three dots', () => {
    expect(onboardingCopy).toHaveLength(3);
    expect(ENTRY_STEP_COUNT).toBe(3);
  });
});

describe('panel 2 — one connected life', () => {
  it('shows all eight product identities', () => {
    expect(ORBIT_RING).toHaveLength(8);

    const ids = ORBIT_RING.map((position) => position.id).sort();
    expect(ids).toEqual(
      ['faith', 'family', 'finance', 'goals', 'health', 'learning', 'noorAI', 'planner'].sort(),
    );
  });

  it('spaces them evenly, so no identity reads as more important', () => {
    const angles = ORBIT_RING.map((p) => p.angle).sort((a, b) => a - b);
    const gaps = angles.slice(1).map((angle, i) => angle - (angles[i] ?? 0));
    // Eight positions on one clock: every gap is 45°.
    expect(new Set(gaps)).toEqual(new Set([45]));
  });

  it('leaves the centre empty rather than repeating Noor AI', async () => {
    await render(
      <AuthProvider>
        <OnboardingTwo />
      </AuthProvider>,
    );

    expect(screen.getByTestId('onboarding-two-ring')).toBeTruthy();
    // Noor AI is one of the eight on the ring here; a centre robot would show it twice.
    expect(screen.queryByTestId('onboarding-two-ring-centre')).toBeNull();
    expect(screen.getByTestId('onboarding-two-ring-noorAI')).toBeTruthy();
  });
});

describe('panel 3 — AI with boundaries', () => {
  it('surrounds the robot with exactly seven modules', () => {
    expect(FULL_RING).toHaveLength(7);
  });

  it('includes Health', () => {
    // The bug this exists to prevent: panel 3 shipped using SELECTED_RING, which drops Health, so
    // the panel claiming module-specific AI was quietly missing a module.
    expect(FULL_RING.map((p) => p.id)).toContain('health');
    expect(SELECTED_RING.map((p) => p.id)).not.toContain('health');
  });

  it('includes every module and repeats none', () => {
    expect(FULL_RING.map((p) => p.id).sort()).toEqual([...MODULES_ON_PANEL_THREE].sort());
  });

  it('does not put Noor AI on the ring, because the centre already is it', () => {
    expect(FULL_RING.map((p) => p.id)).not.toContain('noorAI');
  });

  it('renders the robot, the shield and all seven modules', async () => {
    await render(
      <AuthProvider>
        <OnboardingThree />
      </AuthProvider>,
    );

    expect(screen.getByTestId('onboarding-three-ring-centre')).toBeTruthy();
    expect(screen.getByTestId('onboarding-three-ring-shield')).toBeTruthy();
    for (const id of MODULES_ON_PANEL_THREE) {
      expect(screen.getByTestId(`onboarding-three-ring-${id}`)).toBeTruthy();
    }
  });

  it('renders Health specifically', async () => {
    await render(
      <AuthProvider>
        <OnboardingThree />
      </AuthProvider>,
    );

    expect(screen.getByTestId('onboarding-three-ring-health')).toBeTruthy();
  });
});

describe('panel 1 — family', () => {
  it('keeps the approved family-and-robot artwork, not the splash emblem', async () => {
    await render(
      <AuthProvider>
        <OnboardingOne />
      </AuthProvider>,
    );

    // The splash and panel 1 must stay visually distinct; panel 1 keeps its own illustration.
    expect(screen.getByTestId('onboarding-one-artwork-image')).toBeTruthy();
    expect(screen.queryByTestId('splash-artwork')).toBeNull();
  });
});

describe('the two ring panels are not the same picture twice', () => {
  it('differs in centre and in ring membership', () => {
    expect(ORBIT_RING).toHaveLength(8);
    expect(FULL_RING).toHaveLength(7);
    // Panel 2 carries Noor AI on the ring; panel 3 carries it at the centre.
    expect(ORBIT_RING.map((p) => p.id)).toContain('noorAI');
    expect(FULL_RING.map((p) => p.id)).not.toContain('noorAI');
  });
});
