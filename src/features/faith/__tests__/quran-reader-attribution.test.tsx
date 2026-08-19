import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { QURAN_CONTENT_ATTRIBUTION } from '@features/faith/data/dhikr/quran-content-attribution';
import { renderReader } from '@/test-support/faith-reader';

/**
 * The source credit the retention permission requires, on the surface that shows the retained text.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Why this is on the reader when a provenance badge deliberately is not ──
 * The "Source: Quran Foundation Content API" badge was removed from the three reading surfaces on
 * purpose: repeated above every verse it becomes furniture and stops being read. That decision
 * stands, and `UnverifiedSourceNotice` still renders nothing for a verified source.
 *
 * This is a different obligation with a different answer. The 2026-08-18 permission that allows this
 * app to retain the complete Arabic text requires the sentence to be **displayed**, and a sentence
 * reachable only by opening a secondary screen is not displayed where the content is. So it appears
 * once, at the foot of the reading column.
 *
 * ── Why the sentence is compared to the constant and never typed here ──────
 * It is specified exactly. A full stop lost to a layout squeeze, "provided by" softened to "from",
 * a line shortened to fit a caption — each is a licence condition broken, and each is the kind of
 * change that looks like tidying. The constant is the single home, pinned byte for byte by its own
 * test, and this asserts the screen renders that value rather than a copy of it.
 * ═══════════════════════════════════════════════════════════════════════════
 */

describe('the reader’s source credit', () => {
  it('displays the required sentence on the reading surface itself', async () => {
    const { view } = await renderReader();

    const line = await view.findByTestId('faith-reader-attribution');
    expect(line).toBeTruthy();
    expect(await view.findByText(QURAN_CONTENT_ATTRIBUTION)).toBeTruthy();
  });

  it('names Quran Foundation and Quran.com, which is what the condition asks for', () => {
    expect(QURAN_CONTENT_ATTRIBUTION).toContain('Quran Foundation');
    expect(QURAN_CONTENT_ATTRIBUTION).toContain('Quran.com');
    expect(QURAN_CONTENT_ATTRIBUTION.endsWith('.')).toBe(true);
  });

  it('renders the constant rather than a second copy of the sentence', () => {
    /*
      A literal in the screen would drift from the constant the moment either is edited, and the
      drift would be invisible — two sentences that read the same and are not the same.
    */
    const source = readFileSync(
      join(process.cwd(), 'src/features/faith/screens/reader-screen.tsx'),
      'utf8',
    );
    expect(source).toContain('QURAN_CONTENT_ATTRIBUTION');
    expect(source).not.toContain('provided by Quran Foundation');
  });

  it('keeps the translator credit as a separate line, because one does not satisfy the other', async () => {
    /*
      Two requirements: this sentence credits the *source*, and the translator credit names the
      person whose reading of the meaning is on screen. Showing one has never satisfied the other.
    */
    const { view } = await renderReader();

    expect(await view.findByTestId('faith-reader-attribution')).toBeTruthy();
    expect(await view.findByTestId('faith-reader-translation-credit')).toBeTruthy();
  });
});
