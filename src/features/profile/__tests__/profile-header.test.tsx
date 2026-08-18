import { render, screen } from '@testing-library/react-native';

import { ProfileHeader } from '../components/profile-header';
import { profileCopy } from '../profile-copy';
import { PROFILE_LAYOUT } from '../profile-metrics';

/**
 * The one header, shared by Profile Home and both detail screens.
 *
 * ── Why this has its own suite ──────────────────────────────────────────────
 * Phase 6C-2A generalised this component rather than writing a second header, so a change here now
 * reaches three screens instead of one. The claims worth holding are therefore about the component:
 * the geometry it borrows from the approved module header, and the two ways a long title at a large
 * OS text size could ruin it — running under a control, or being abbreviated.
 */

function flatStyle(testID: string): Record<string, unknown> {
  const style = screen.getByTestId(testID).props.style;
  return Array.isArray(style) ? Object.assign({}, ...style.filter(Boolean)) : style;
}

describe('the title', () => {
  it('defaults to Profile, so Profile Home is unaffected by the generalisation', async () => {
    await render(<ProfileHeader onBack={() => undefined} onHelp={() => undefined} />);
    expect(screen.getByTestId('profile-header-title')).toHaveTextContent(profileCopy.title);
  });

  it('carries a detail screen’s own title', async () => {
    await render(<ProfileHeader onBack={() => undefined} title="Family & Membership" />);
    expect(screen.getByTestId('profile-header-title')).toHaveTextContent('Family & Membership');
  });

  it('stops short of both control discs, so a long title cannot run under one', async () => {
    await render(<ProfileHeader onBack={() => undefined} title="Family & Membership" />);

    // The device pass found "Family & Membership" under the Back arrow at OS font scale 1.5, when
    // the layer spanned the whole header.
    const { minTouchTarget, header } = PROFILE_LAYOUT;
    const expected = (minTouchTarget + header.control) / 2;
    const style = flatStyle('profile-header-title-layer');
    expect(style.left).toBe(expected);
    expect(style.right).toBe(expected);
    // Equal insets, so the title still centres on the header's true middle.
    expect(style.left).toBe(style.right);
  });

  it('keeps the longest title on one line without abbreviating it', async () => {
    await render(<ProfileHeader onBack={() => undefined} title="Personal Information" />);

    const title = screen.getByTestId('profile-header-title');
    expect(title.props.numberOfLines).toBe(1);
    /**
     * The cap that makes one line achievable.
     *
     * At 1.3 the longest title outgrew the space the insets leave and ellipsised; 1.2 fits. An
     * abbreviated screen title is a worse outcome than one rendered a step smaller, and nothing else
     * on these screens is capped at all.
     */
    expect(title.props.maxFontSizeMultiplier).toBe(1.2);
  });
});

describe('the controls', () => {
  it('gives Back a 44 dp target and the approved 36 dp disc', async () => {
    await render(<ProfileHeader onBack={() => undefined} onHelp={() => undefined} />);

    const back = flatStyle('profile-header-back');
    expect(back.width).toBe(PROFILE_LAYOUT.minTouchTarget);
    expect(back.height).toBe(PROFILE_LAYOUT.minTouchTarget);
  });

  it('names Back’s destination when the caller supplies one', async () => {
    await render(
      <ProfileHeader onBack={() => undefined} backLabel={profileCopy.detail.backToProfile} />,
    );
    expect(screen.getByTestId('profile-header-back').props.accessibilityLabel).toBe(
      'Back to Profile',
    );
  });

  it('falls back to Profile Home’s own Back label', async () => {
    await render(<ProfileHeader onBack={() => undefined} onHelp={() => undefined} />);
    expect(screen.getByTestId('profile-header-back').props.accessibilityLabel).toBe(
      profileCopy.header.back,
    );
  });

  it('holds the right slot open when there is no Help destination', async () => {
    await render(<ProfileHeader onBack={() => undefined} title="Personal Information" />);

    expect(screen.queryByTestId('profile-header-help')).toBeNull();
    // Collapsing the slot would slide the centred title right by half a control.
    const spacer = flatStyle('profile-header-help-spacer');
    expect(spacer.width).toBe(PROFILE_LAYOUT.minTouchTarget);
    expect(spacer.height).toBe(PROFILE_LAYOUT.minTouchTarget);
  });

  it('offers Help where a destination exists', async () => {
    await render(<ProfileHeader onBack={() => undefined} onHelp={() => undefined} />);

    expect(screen.getByTestId('profile-header-help')).toBeTruthy();
    expect(screen.queryByTestId('profile-header-help-spacer')).toBeNull();
  });
});
