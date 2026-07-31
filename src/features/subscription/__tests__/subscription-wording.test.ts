import fs from 'node:fs';
import path from 'node:path';

import { familyWording } from '../subscription-copy';

/**
 * The approved commercial wording.
 *
 * The brief forbids the four-seat wording anywhere and fixes the family sentences verbatim. A
 * rule that lives only in a document gets broken; asserted against the source tree, it cannot be.
 */

/** Every source and doc file, so a forbidden phrase cannot hide in a screen or a spec. */
function collectFiles(root: string, extensions: readonly string[]): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) {
          continue;
        }
        walk(full);
        continue;
      }
      if (extensions.some((ext) => entry.name.endsWith(ext))) {
        found.push(full);
      }
    }
  };
  walk(root);
  return found;
}

describe('the approved family wording', () => {
  it('is exactly as approved', () => {
    expect(familyWording.headline).toBe('Share NoorLife with up to 5 family members.');
    expect(familyWording.supporting).toBe(
      'One organizer and five additional members. Everyone gets their own private account.',
    );
  });

  it('says five additional members, meaning six accounts in total', () => {
    // The pair has to be unambiguous together: "up to 5" alone could be read as five total.
    expect(familyWording.headline).toContain('up to 5 family members');
    expect(familyWording.supporting).toContain('One organizer and five additional members');
  });
});

describe('the superseded four-seat wording appears nowhere', () => {
  const forbidden = /family of (4|four)/i;

  it('is absent from all source files', () => {
    const files = collectFiles(path.join(process.cwd(), 'src'), ['.ts', '.tsx']);
    const offenders = files.filter((file) => forbidden.test(fs.readFileSync(file, 'utf8')));

    expect(offenders).toEqual([]);
  });

  it('is absent from the documentation, including the design spec', () => {
    // The design spec's §16 carried this heading before Phase 5 superseded it. Left unfixed, the
    // repository would document a four-seat plan and ship a six-seat one.
    const files = collectFiles(path.join(process.cwd(), 'docs'), ['.md']);
    const offenders = files
      .filter((file) => forbidden.test(fs.readFileSync(file, 'utf8')))
      // The audit records the conflict by name, so it is allowed to quote the phrase.
      .filter((file) => !file.endsWith('PHASE_5_SUBSCRIPTION_AUDIT.md'));

    expect(offenders).toEqual([]);
  });
});

describe('no card collection anywhere in the subscription UI', () => {
  it('has no card-number, CVV or expiry field', () => {
    // Rule 10: card details are never collected inside NoorLife. Nothing in this feature should
    // even reference the concept as an input.
    // Tests are excluded: this file has to name the forbidden identifiers in order to search for
    // them, so without the filter it matches itself.
    const files = collectFiles(path.join(process.cwd(), 'src', 'features', 'subscription'), [
      '.ts',
      '.tsx',
    ]).filter((file) => !file.includes('__tests__'));
    const forbidden = /\b(cardNumber|card_number|cvv|cvc|expiryMonth|expiry_month|creditCard)\b/i;
    const offenders = files.filter((file) => forbidden.test(fs.readFileSync(file, 'utf8')));

    expect(offenders).toEqual([]);
  });
});
