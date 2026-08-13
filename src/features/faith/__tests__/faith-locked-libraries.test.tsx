import { render, screen } from '@testing-library/react-native';

import { DuasScreen } from '../screens/duas-screen';
import { HadithScreen } from '../screens/hadith-screen';

/**
 * The approved Hadith and Duas locked designs, asserted as copy and as semantics.
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

const DUA_ROWS = [
  ['faith-duas-row-morning-evening', 'Morning & evening', 'Daily remembrance and protection'],
  ['faith-duas-row-everyday', 'Everyday moments', 'Home, travel, meals and sleep'],
  ['faith-duas-row-bookmarks', 'Bookmarks', 'Your saved supplications'],
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

describe('the Duas locked library', () => {
  it('renders the approved status card copy', async () => {
    await render(<DuasScreen />);

    expect(screen.getByText('Dua library')).toBeTruthy();
    expect(
      screen.getByText(
        'Verified supplications will appear here when a trusted source is connected.',
      ),
    ).toBeTruthy();
  });

  it.each(DUA_ROWS)('renders %s with its approved label and description', (id, label, desc) => {
    return render(<DuasScreen />).then(() => {
      expect(screen.getByTestId(id)).toBeTruthy();
      expect(screen.getByText(label)).toBeTruthy();
      expect(screen.getByText(desc)).toBeTruthy();
    });
  });

  it('renders the approved trust notice', async () => {
    await render(<DuasScreen />);
    expect(screen.getByText('No unverified supplications are shown.')).toBeTruthy();
  });
});

describe('the preview rows are informational, not controls', () => {
  it.each([...HADITH_ROWS.map((r) => r[0]), ...DUA_ROWS.map((r) => r[0])])(
    '%s does not navigate and is announced as unavailable',
    async (testID) => {
      await render(testID.includes('hadith') ? <HadithScreen /> : <DuasScreen />);
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

describe('no religious content is reachable on either screen', () => {
  /**
   * A deliberately blunt scan of everything the two screens render.
   *
   * It is not looking for a specific removed fixture; it is looking for the *shape* of religious
   * content — an Arabic character, a grading vocabulary word, a chapter-and-number citation. Those
   * are the things that must not reappear while these screens are locked, whatever route they
   * arrive by, and a substring scan catches a reintroduction that a testID assertion would miss.
   */
  const ARABIC = /[؀-ۿ]/;
  const GRADING = /\b(sahih|hasan|da'?if|mutawatir|authentic(ated)? narration)\b/i;
  const CITATION = /\b(bukhari|muslim|tirmidhi|nawawi|abu dawud|ibn majah)\b/i;

  it.each([
    ['Hadith', <HadithScreen key="h" />],
    ['Duas', <DuasScreen key="d" />],
  ])('%s renders no Arabic, grade or collection citation', async (_name, element) => {
    await render(element);
    const text = JSON.stringify(screen.toJSON());

    expect(ARABIC.test(text)).toBe(false);
    expect(GRADING.test(text)).toBe(false);
    expect(CITATION.test(text)).toBe(false);
  });
});
