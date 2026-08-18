import { render, screen, userEvent } from '@testing-library/react-native';

import { AuthIllustration } from '../components/auth-illustration';
import { noorLifeAssets } from '@shared/assets/noorlife-assets';
import { onboardingCopy } from '../entry-auth-copy';
import { ENTRY_STEP_COUNT } from '../entry-steps';
import { OnboardingScreen } from '../screens/onboarding-screen';
import { mockRouter } from '../../../../jest.setup';

async function renderPanel(overrides?: Partial<Parameters<typeof OnboardingScreen>[0]>) {
  const onPrimary = jest.fn();
  const onSkip = jest.fn();
  await render(
    <OnboardingScreen
      step={0}
      title={onboardingCopy[0].title}
      subtitle={onboardingCopy[0].subtitle}
      illustration={
        <AuthIllustration
          source={noorLifeAssets.entryAuth.familyRobot}
          accessibilityLabel="A family standing together with the Noor AI assistant."
          testID="panel-artwork"
        />
      }
      primaryLabel="Next"
      onPrimary={onPrimary}
      onSkip={onSkip}
      testID="panel"
      {...overrides}
    />,
  );
  return { onPrimary, onSkip };
}

describe('onboarding copy', () => {
  it('carries the locked wording verbatim', () => {
    expect(onboardingCopy[0].subtitle).toBe(
      'Bring your loved ones together and stay connected in meaningful ways.',
    );
    expect(onboardingCopy[1].subtitle).toBe(
      'From faith and health to goals and finances—manage it all in one place.',
    );
    expect(onboardingCopy[2].subtitle).toBe(
      'NoorLife’s AI is module-specific and privacy-first—built to support, never overstep.',
    );
    expect(onboardingCopy[2].primaryLabel).toBe('Get Started');
  });

  it('spells the locked words correctly', () => {
    // These two misspellings are explicit reject criteria in the Main Home pass and the same
    // words recur here, so they are asserted rather than trusted.
    const all = onboardingCopy.map((c) => `${c.title} ${c.subtitle}`).join(' ');
    expect(all).toContain('beautifully');
    expect(all).toContain('NoorLife');
    expect(all).not.toMatch(/beutifully|Beutifully|NoorLIfe|Noorlife/);
  });

  it('breaks every heading onto exactly two lines', () => {
    for (const { title } of onboardingCopy) {
      expect(title.split('\n')).toHaveLength(2);
    }
  });
});

describe('onboarding panel', () => {
  it('renders the heading, supporting copy and artwork', async () => {
    await renderPanel();

    expect(screen.getByText(onboardingCopy[0].title)).toBeTruthy();
    expect(screen.getByText(onboardingCopy[0].subtitle)).toBeTruthy();
    expect(screen.getByTestId('panel-artwork-image')).toBeTruthy();
  });

  it('gives the illustration slot a width to render into', async () => {
    await renderPanel();

    // Regression guard. The slot was `alignItems: 'center'`, which makes a flex child shrink-wrap
    // its width; AuthIllustration has no explicit width, so it collapsed to zero and its
    // `width: '100%'` image drew nothing. Panel 02 lost its artwork on device while 03 and 04 kept
    // theirs, because MedallionRing sets an explicit width and was unaffected.
    const slot = screen.getByTestId('panel-illustration');
    const flattened = Object.assign({}, ...[slot.props.style].flat(Infinity).filter(Boolean));
    expect(flattened.alignItems).not.toBe('center');
    expect(flattened.flex).toBe(1);
  });

  it('marks the heading as a header for assistive technology', async () => {
    await renderPanel();

    expect(screen.getByRole('header')).toBeTruthy();
  });

  it('shows the whole five-step entry sequence with the current one active', async () => {
    await renderPanel({ step: 1 });

    // Onboarding is steps 0–2 of a sequence that continues through Welcome (3) and the
    // shared Sign In / Sign Up dot (4) — see ENTRY_STEP_COUNT.
    expect(screen.getByTestId('panel-dots-0')).toBeTruthy();
    expect(screen.getByTestId('panel-dots-1-active')).toBeTruthy();
    expect(screen.getByTestId('panel-dots-2')).toBeTruthy();
    expect(screen.getByTestId('panel-dots-3')).toBeTruthy();
    expect(screen.getByTestId('panel-dots-4')).toBeTruthy();
    expect(screen.queryByTestId('panel-dots-5')).toBeNull();
    expect(ENTRY_STEP_COUNT).toBe(5);
  });

  it('announces the step to a screen reader', async () => {
    await renderPanel({ step: 1 });

    expect(screen.getByLabelText('Step 2 of 5')).toBeTruthy();
  });

  it('returns to an earlier step when its dot is tapped', async () => {
    const user = userEvent.setup();
    await renderPanel({ step: 2 });

    await user.press(screen.getByTestId('panel-dots-0'));

    // `replace`, not `back()`: Welcome is frequently the stack root, so popping does nothing.
    expect(mockRouter.replace).toHaveBeenCalledWith('/onboarding/one');
  });

  it('leaves the current and later dots inert, so the flow cannot skip ahead', async () => {
    const user = userEvent.setup();
    await renderPanel({ step: 1 });

    await user.press(screen.getByTestId('panel-dots-1-active'));
    await user.press(screen.getByTestId('panel-dots-3'));

    // Jumping to Welcome would leave onboarding unrecorded as completed.
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  it('offers exactly one Skip action, at the bottom', async () => {
    await renderPanel();

    // The prompt warns against duplicating Skip; the reference has it at the bottom only.
    expect(screen.getAllByText('Skip')).toHaveLength(1);
  });

  it('invokes the primary and skip handlers', async () => {
    const user = userEvent.setup();
    const { onPrimary, onSkip } = await renderPanel();

    await user.press(screen.getByTestId('panel-primary'));
    expect(onPrimary).toHaveBeenCalledTimes(1);

    await user.press(screen.getByTestId('panel-skip'));
    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it('drops Skip on the final panel, leaving one full-width primary', async () => {
    await renderPanel({ step: 2, primaryLabel: 'Get Started', onSkip: undefined });

    expect(screen.queryByText('Skip')).toBeNull();
    expect(screen.getByText('Get Started')).toBeTruthy();
  });
});
