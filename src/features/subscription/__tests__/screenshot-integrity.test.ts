import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Screenshot evidence integrity.
 *
 * Phase 5 shipped two pairs of byte-identical screenshots — `03-single-monthly.png` with
 * `04-single-yearly.png`, and `08-processing.png` with `09-success-single.png`. Presented as separate
 * state evidence they were worthless: the monthly/yearly pair proved nothing about the billing
 * toggle, and the processing/success pair proved nothing about the purchase flow.
 *
 * A duplicate is the specific failure mode of a scripted capture sweep — a deep link that did not
 * navigate, or a screenshot taken before the screen changed, silently produces the previous frame.
 * Nothing about the file names reveals it, which is why it needs a test.
 */

const SHOT_DIR = path.join(process.cwd(), 'design-reference', 'phase-5-subscriptions');

function screenshots(): readonly string[] {
  if (!fs.existsSync(SHOT_DIR)) {
    return [];
  }
  return fs
    .readdirSync(SHOT_DIR)
    .filter((name) => name.endsWith('.png'))
    .sort();
}

function sha256(file: string): string {
  return crypto
    .createHash('sha256')
    .update(fs.readFileSync(path.join(SHOT_DIR, file)))
    .digest('hex');
}

describe('phase 5 screenshot evidence', () => {
  it('exists', () => {
    expect(screenshots().length).toBeGreaterThan(0);
  });

  it('contains no two files with identical bytes', () => {
    const byHash = new Map<string, string[]>();
    for (const file of screenshots()) {
      const hash = sha256(file);
      byHash.set(hash, [...(byHash.get(hash) ?? []), file]);
    }

    // Reported as groups so a failure names exactly which captures need redoing.
    const duplicateGroups = [...byHash.values()].filter((group) => group.length > 1);

    expect(duplicateGroups).toEqual([]);
  });

  it('has no empty or truncated captures', () => {
    // A screencap that raced the app can arrive as a few hundred bytes of header.
    const tooSmall = screenshots().filter(
      (file) => fs.statSync(path.join(SHOT_DIR, file)).size < 10_000,
    );

    expect(tooSmall).toEqual([]);
  });
});
