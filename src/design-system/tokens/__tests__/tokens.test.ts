import {
  elementSize,
  iconSize,
  layout,
  modulePalettes,
  navigationColors,
  neutralColors,
  radius,
  semanticColors,
  shadowSpecification,
  spacing,
  spacingScale,
  textScale,
  touchTarget,
  fontFamilies,
  motionDuration,
  pressScale,
} from '..';

/**
 * Design-token lock tests.
 *
 * The tokens are described as locked in docs/NOORLIFE_UI_DESIGN_SPEC.md §2. These
 * tests are the lock: a value cannot drift without a test failing, which forces
 * the specification and the code to be changed together.
 */

describe('§2.1 neutral foundation', () => {
  it('matches the specified values exactly', () => {
    expect(neutralColors).toEqual({
      canvas: '#F7F8FA',
      surface: '#FFFFFF',
      surfaceSoft: '#F1F3F6',
      border: '#E2E6EC',
      divider: '#E9ECF1',
      textPrimary: '#172033',
      textSecondary: '#667085',
      textMuted: '#98A2B3',
      disabled: '#C8CED8',
      scrim: 'rgba(17,24,39,0.45)',
    });
  });

  it('uses a warm neutral canvas rather than a blue tint', () => {
    expect(neutralColors.canvas).toBe('#F7F8FA');
    expect(neutralColors.canvas).not.toBe(semanticColors.primary);
  });
});

describe('§2.2 semantic colours', () => {
  it('matches the specified values exactly', () => {
    expect(semanticColors).toEqual({
      primary: '#3157C8',
      success: '#22A06B',
      warning: '#E6A23C',
      error: '#D92D4C',
      info: '#3A8DDE',
    });
  });
});

describe('§2.3 module palettes', () => {
  it('defines all nine palettes with the specified values', () => {
    expect(modulePalettes).toEqual({
      main: { primary: '#3949AB', dark: '#26337D', soft: '#EEF0FF', supporting: '#F2B84B' },
      'noor-ai': { primary: '#6556C8', dark: '#473A9E', soft: '#F0EDFF', supporting: '#45BFD1' },
      faith: { primary: '#23856D', dark: '#155E4D', soft: '#E9F6F1', supporting: '#D5A94E' },
      health: { primary: '#4A9FD8', dark: '#2875A8', soft: '#EAF6FC', supporting: '#65C7B2' },
      planner: { primary: '#5A72C9', dark: '#3C50A1', soft: '#EEF1FB', supporting: '#87A7E8' },
      finance: { primary: '#E38A32', dark: '#B7641F', soft: '#FFF3E6', supporting: '#F1B75B' },
      learning: { primary: '#7657D6', dark: '#5839B5', soft: '#F1EDFF', supporting: '#B695F3' },
      family: { primary: '#D95B82', dark: '#A93B60', soft: '#FDECF2', supporting: '#F0A4B8' },
      goals: { primary: '#269B94', dark: '#15716C', soft: '#E8F7F5', supporting: '#67C9BE' },
    });
  });

  it('keeps Faith green-led — its primary is greener than it is blue or red', () => {
    // #23856D: R=0x23, G=0x85, B=0x6D
    const { primary } = modulePalettes.faith;
    const [r, g, b] = channels(primary);
    expect(g).toBeGreaterThan(r);
    expect(g).toBeGreaterThan(b);
  });

  it('keeps Health light-blue-led — its primary is bluest', () => {
    // #4A9FD8: R=0x4A, G=0x9F, B=0xD8
    const [r, g, b] = channels(modulePalettes.health.primary);
    expect(b).toBeGreaterThan(g);
    expect(b).toBeGreaterThan(r);
  });

  it('keeps Finance warm — its primary is reddest', () => {
    const [r, g, b] = channels(modulePalettes.finance.primary);
    expect(r).toBeGreaterThan(g);
    expect(r).toBeGreaterThan(b);
  });
});

describe('§2.4 typography', () => {
  it('uses only the four permitted Poppins weights', () => {
    expect(Object.values(fontFamilies)).toEqual([
      'Poppins_400Regular',
      'Poppins_500Medium',
      'Poppins_600SemiBold',
      'Poppins_700Bold',
    ]);
  });

  it('matches the specified size and line-height pairs', () => {
    expect(textScale.display).toEqual({ size: 32, lineHeight: 40, weight: 'bold' });
    expect(textScale.heroTitle).toEqual({ size: 24, lineHeight: 31, weight: 'bold' });
    expect(textScale.screenTitle).toEqual({ size: 20, lineHeight: 28, weight: 'semiBold' });
    expect(textScale.sectionTitle).toEqual({ size: 17, lineHeight: 24, weight: 'semiBold' });
    expect(textScale.cardTitle).toEqual({ size: 15, lineHeight: 22, weight: 'semiBold' });
    expect(textScale.body).toEqual({ size: 14, lineHeight: 21, weight: 'regular' });
    expect(textScale.bodyMedium).toEqual({ size: 14, lineHeight: 21, weight: 'medium' });
    expect(textScale.label).toEqual({ size: 12, lineHeight: 17, weight: 'medium' });
    expect(textScale.caption).toEqual({ size: 11, lineHeight: 16, weight: 'regular' });
    expect(textScale.dataLarge).toEqual({ size: 34, lineHeight: 40, weight: 'semiBold' });
  });

  it('keeps body text at the 14 px minimum', () => {
    expect(textScale.body.size).toBe(14);
  });
});

describe('§2.5 spacing, radius, elevation', () => {
  it('uses the 8-point scale', () => {
    expect(spacingScale).toEqual([4, 8, 12, 16, 24, 32, 40, 48]);
    expect(Object.values(spacing).sort((a, b) => a - b)).toEqual([...spacingScale]);
  });

  it('matches the specified layout constants', () => {
    expect(layout.screenPaddingHorizontal).toBe(20);
    expect(layout.cardPadding).toBe(16);
    expect(layout.heroPadding).toBe(20);
    expect(layout.sectionGap).toBe(24);
    expect(layout.cardGap).toBe(12);
    expect(layout.heroMinHeight).toBe(180);
  });

  it('caps an unexplained blank region at 24 px (§3.0)', () => {
    expect(layout.maxUnexplainedGap).toBe(24);
  });

  it('matches the specified radii', () => {
    expect(radius.control).toBe(12);
    expect(radius.card).toBe(18);
    expect(radius.hero).toBe(24);
    expect(radius.pill).toBe(999);
  });

  it('preserves the specified shadow definitions', () => {
    expect(shadowSpecification.card).toEqual({
      offsetY: 4,
      blur: 16,
      color: 'rgba(23, 32, 51, 0.07)',
    });
    expect(shadowSpecification.raised).toEqual({
      offsetY: 10,
      blur: 28,
      color: 'rgba(23, 32, 51, 0.12)',
    });
    expect(shadowSpecification.ai).toEqual({
      offsetY: 6,
      blur: 20,
      color: 'rgba(101, 86, 200, 0.22)',
    });
  });
});

describe('§3.1, §3.2, §8 sizes', () => {
  it('sets the minimum touch target to 44 px', () => {
    expect(touchTarget.minimum).toBe(44);
  });

  it('sets the module-AI control to the locked 54 px', () => {
    // Design spec §3.1/§3.2 states 52; the Main Home implementation lock §13 is the
    // later, more specific contract and fixes it at 54 with a 3 px ring and a 17 px
    // raise. The navigation bar is shared, so 54 applies throughout.
    expect(elementSize.aiNavButton).toBe(54);
    expect(elementSize.aiNavButtonBorder).toBe(3);
    expect(elementSize.aiNavButtonRaise).toBe(17);
    expect(elementSize.aiNavRobot).toBe(38);
  });

  it('sets the bottom-navigation bar to the locked 72 px', () => {
    expect(elementSize.bottomNavHeight).toBe(72);
    expect(elementSize.bottomNavIcon).toBe(22);
  });

  it('sets the module top-bar sizes from §3.2', () => {
    expect(elementSize.moduleTopBarButton).toBe(44);
    expect(elementSize.moduleTopBarAvatar).toBe(36);
  });

  it('uses equal-height 52 px authentication buttons (§03)', () => {
    expect(elementSize.authButton).toBe(52);
  });

  it('keeps every button at or above the minimum touch target', () => {
    expect(elementSize.buttonHeight).toBeGreaterThanOrEqual(touchTarget.minimum);
    expect(elementSize.authButton).toBeGreaterThanOrEqual(touchTarget.minimum);
  });

  it('keeps icon sizes on the 4-point grid', () => {
    for (const size of Object.values(iconSize)) {
      expect(size % 4).toBe(0);
    }
  });
});

describe('§3.2 navigation colours', () => {
  it('uses the specified inactive colour', () => {
    expect(navigationColors.inactive).toBe('#7A8496');
  });
});

describe('§7 motion', () => {
  it('matches the specified durations', () => {
    expect(motionDuration.standard).toBe(200);
    expect(motionDuration.modal).toBe(240);
    expect(motionDuration.press).toBe(100);
    expect(motionDuration.progressMin).toBe(400);
    expect(motionDuration.progressMax).toBe(600);
  });

  it('scales a pressed button to 0.98', () => {
    expect(pressScale).toBe(0.98);
  });
});

/** Splits a `#RRGGBB` literal into numeric channels. */
function channels(hex: string): readonly [number, number, number] {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}
