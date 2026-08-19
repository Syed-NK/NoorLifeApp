import { render, screen } from '@testing-library/react-native';

import { HadithScreen } from '../screens/hadith-screen';

/**
 * The approved Hadith locked design, asserted as copy and as semantics.
 *
 * ── Duas used to be here, and is not locked any more ───────────────────────
 * It carried the same three disabled preview rows and the same status card, for the same reason:
 * NoorLife had no approved supplication provider. It still has none, and it now has something else —
 * the user's own Quran selections, resolved from the copy of the Arabic this device retained. A
 * screen with working content is not a locked library, and asserting locked-library copy on it
 * would pin a claim that is no longer true.
 *
 * The Duas screen's own assertions — including the ones that matter most here, that no Hadith
 * grading vocabulary or collection citation appears, and that no Arabic appears until the user has
 * chosen a verse — live in `faith-duas-screen.test.tsx`.
 *
 * ── Why the copy is asserted verbatim ───────────────────────────────────────
 * Every string on these two screens was approved word for word, and each one is a claim about what
 * NoorLife does and does not have. "Verified collections will appear here when a trusted provider
 * is connected" promises a provider and nothing else; a well-meaning edit to "Collections are
 * loading" would turn a locked state into a lie. Pinning the exact text makes rewording a decision
 * somebody has to take deliberately.
 *
 * ── Why the disabled semantics are asserted at all ──────────────────────────
 * The rows look like list rows, and list rows are normally pressable. The single most likely future
 * regression is somebody wiring one up — to a screen that cannot exist, because no provider is
 * approved. These tests fail the moment a row gains a press handler or a button role.
 */

const HADITH_ROWS = [
  ['faith-hadith-row-collections', 'Collections', 'Browse authenticated sources'],
  ['faith-hadith-row-bookmarks', 'Bookmarks', 'Your saved narrations'],
  ['faith-hadith-row-history', 'Reading history', 'Continue where you stopped'],
] as const;

describe('the Hadith locked library', () => {
  it('renders the approved status card copy', async () => {
    await render(<HadithScreen />);

    expect(screen.getByText('Hadith library')).toBeTruthy();
    expect(
      screen.getByText(
        'Verified collections will appear here when a trusted provider is connected.',
      ),
    ).toBeTruthy();
  });

  it.each(HADITH_ROWS)('renders %s with its approved label and description', (id, label, desc) => {
    return render(<HadithScreen />).then(() => {
      expect(screen.getByTestId(id)).toBeTruthy();
      expect(screen.getByText(label)).toBeTruthy();
      expect(screen.getByText(desc)).toBeTruthy();
    });
  });

  it('renders the approved trust notice', async () => {
    await render(<HadithScreen />);
    expect(screen.getByText('No unverified narrations are shown.')).toBeTruthy();
  });
});

describe('the preview rows are informational, not controls', () => {
  it.each(HADITH_ROWS.map((r) => r[0]))(
    '%s does not navigate and is announced as unavailable',
    async (testID) => {
      await render(<HadithScreen />);
      const row = screen.getByTestId(testID);

      // Not a control: no handler to fire, and no role that would advertise one.
      expect(row.props.onPress).toBeUndefined();
      expect(row.props.onStartShouldSetResponder).toBeUndefined();
      expect(row.props.accessibilityRole).not.toBe('button');
      expect(row.props.accessibilityRole).not.toBe('link');

      // And explicitly announced as unavailable rather than merely silent about it.
      expect(row.props.accessibilityState).toEqual({ disabled: true });
      expect(row.props.accessibilityLabel).toContain('not available yet');
    },
  );

  it('shows a Coming soon label on every row', async () => {
    await render(<HadithScreen />);
    expect(screen.getAllByText('Coming soon')).toHaveLength(HADITH_ROWS.length);
  });
});

describe('no religious content is reachable on the Hadith screen', () => {
  /**
   * A deliberately blunt scan of everything the screen renders.
   *
   * It is not looking for a specific removed fixture; it is looking for the *shape* of religious
   * content — an Arabic character, a grading vocabulary word, a chapter-and-number citation. Those
   * are the things that must not reappear while this screen is locked, whatever route they arrive
   * by, and a substring scan catches a reintroduction that a testID assertion would miss.
   */
  const ARABIC = /[؀-ۿ]/;
  const GRADING = /(sahih|hasan|da'?if|mutawatir|authentic(ated)? narration)/i;
  const CITATION = /(bukhari|muslim|tirmidhi|nawawi|abu dawud|ibn majah)/i;

  it('renders no Arabic, grade or collection citation', async () => {
    await render(<HadithScreen />);
    const text = JSON.stringify(screen.toJSON());

    expect(ARABIC.test(text)).toBe(false);
    expect(GRADING.test(text)).toBe(false);
    expect(CITATION.test(text)).toBe(false);
  });
});
