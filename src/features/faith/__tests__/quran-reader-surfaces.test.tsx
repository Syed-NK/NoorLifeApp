import { AA_TEXT, AA_UI, contrastRatio } from '@features/modules/contrast';
import {
  moduleColorThemes,
  moduleNeutrals,
  readerAyahColors,
  readerDockColors,
  readerPageBackground,
} from '@features/modules/module-tokens';

/**
 * The Qur'an reader's three specified surfaces, and the contrast that has to hold on them.
 *
 * ── Why the exact values are asserted ───────────────────────────────────────
 * `#FDFAF5`, `#FFF2D4` and `#D7EEE3` were specified rather than derived. A token that merely
 * *approximates* a specified colour is one nobody can check against the specification, and both
 * the page and the panel previously were approximations — the panel was Faith's gold at 15% over
 * the page background, which flattened to #F2EDE2. Asserting the literals makes a drift away from
 * the specification a failing test rather than a shade nobody re-measures.
 *
 * ── Why contrast is asserted beside them ────────────────────────────────────
 * Because a specified colour can still be unreadable, and the specification itself invites the
 * check — it offers the active-ayah tint "or a slightly darker accessible emerald tint after
 * contrast verification". This is that verification, kept as a test so it re-runs rather than
 * being done once in a conversation.
 */

describe('the reader page', () => {
  it('is the specified ivory, not the shared module page background', () => {
    expect(readerPageBackground).toBe('#FDFAF5');
    expect(readerPageBackground).not.toBe(moduleNeutrals.pageBackground);
  });

  it('carries every text role the reader draws on it above AA', () => {
    expect(contrastRatio(moduleNeutrals.textPrimary, readerPageBackground)).toBeGreaterThanOrEqual(
      AA_TEXT,
    );
    expect(
      contrastRatio(moduleNeutrals.textSecondary, readerPageBackground),
    ).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrastRatio(moduleColorThemes.faith.ink, readerPageBackground)).toBeGreaterThanOrEqual(
      AA_TEXT,
    );
  });
});

describe('the docked audio player', () => {
  it('is the specified warm gold', () => {
    expect(readerDockColors.surface).toBe('#FFF2D4');
  });

  it('draws its transport in an emerald that clears the text threshold, not just the UI one', () => {
    /**
     * Both thresholds, deliberately. The glyphs only need 3:1 today, but the value is the one a
     * label on this panel would also have to use — see `readerDockColors.accent`.
     */
    expect(contrastRatio(readerDockColors.accent, readerDockColors.surface)).toBeGreaterThanOrEqual(
      AA_UI,
    );
    expect(contrastRatio(readerDockColors.accent, readerDockColors.surface)).toBeGreaterThanOrEqual(
      AA_TEXT,
    );
  });

  it('stays distinguishable from the page it is docked over', () => {
    // Not a contrast requirement — a separation one. The panel has to read as a distinct surface
    // from the ivory column above it, which is the whole reason it is a different colour.
    expect(readerDockColors.surface).not.toBe(readerPageBackground);
  });
});

describe('the reciting ayah', () => {
  it('is the specified emerald tint', () => {
    expect(readerAyahColors.active).toBe('#D7EEE3');
  });

  it('carries scripture well above the AA threshold', () => {
    // 7:1 rather than 4.5:1. This is a long passage of Uthmani script with harakat, read for
    // minutes at a time, so the AAA threshold is the honest target rather than the minimum.
    expect(
      contrastRatio(moduleNeutrals.textPrimary, readerAyahColors.active),
    ).toBeGreaterThanOrEqual(7);
  });

  it('is darker than the ayah the player is merely pointed at', () => {
    /**
     * The ordering is the meaning: `active` is the verse being recited right now and has to be
     * findable on a moving page, `focused` is only where the player is aimed while idle. If the
     * two were ever equal, a paused player would claim audio is playing.
     */
    const luminance = (hex: string) => contrastRatio(hex, '#000000');
    expect(luminance(readerAyahColors.active)).toBeLessThan(luminance(readerAyahColors.focused));
  });
});
