import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { noorLifeAssets, REQUIRED_GOOGLE_MARK_PATH } from '@shared/assets/noorlife-assets';
import { medallionColors, medallionSpec } from '../entry-auth-tokens';

/**
 * Asset contract tests.
 *
 * §18 rejects the implementation if a placeholder remains, if Google is a blue dot, if Apple is a
 * black square, or if a generic envelope or shield stands in for the approved artwork. These assert the
 * properties that would catch each of those, on disk and in the source.
 */

const ROOT = join(__dirname, '..', '..', '..', '..');
const ASSETS = join(ROOT, 'assets', 'images');

/** Reads a PNG's IHDR. Enough to prove dimensions and that an alpha channel is present. */
function readPngHeader(path: string) {
  const buffer = readFileSync(path);
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    colourType: buffer[25],
  };
}

const REQUIRED_PICTOGRAMS = [
  'noor-ai',
  'faith',
  'health',
  'planner',
  'finance',
  'learning',
  'family',
  'goals',
] as const;

describe('approved artwork on disk', () => {
  it.each(REQUIRED_PICTOGRAMS)('assets/images/pictograms/%s.png exists', (id) => {
    expect(existsSync(join(ASSETS, 'pictograms', `${id}.png`))).toBe(true);
  });

  it.each(['privacy-shield', 'email-envelope', 'splash-soft-mint'])(
    'assets/images/entry-auth/%s.png exists',
    (name) => {
      expect(existsSync(join(ASSETS, 'entry-auth', `${name}.png`))).toBe(true);
    },
  );

  it('ships every pictogram with transparency, so none carries a white rectangle', () => {
    // Colour type 6 is RGBA. The pack delivers these as opaque mockup tiles — a white card on a grey
    // page — so an opaque file here would mean the card was never keyed away, which §6 forbids.
    for (const id of REQUIRED_PICTOGRAMS) {
      const { colourType } = readPngHeader(join(ASSETS, 'pictograms', `${id}.png`));
      expect(colourType).toBe(6);
    }
  });

  it('ships the shield and envelope with transparency', () => {
    for (const name of ['privacy-shield', 'email-envelope']) {
      expect(readPngHeader(join(ASSETS, 'entry-auth', `${name}.png`)).colourType).toBe(6);
    }
  });

  it('normalizes every pictogram to one square canvas', () => {
    for (const id of REQUIRED_PICTOGRAMS) {
      const { width, height } = readPngHeader(join(ASSETS, 'pictograms', `${id}.png`));
      expect(width).toBe(height);
      expect(width).toBe(256);
    }
  });
});

describe('asset registry', () => {
  it('resolves a source for all eight modules', () => {
    const keys = Object.keys(noorLifeAssets.modules).sort();
    expect(keys).toEqual(
      ['faith', 'family', 'finance', 'goals', 'health', 'learning', 'noorAI', 'planner'].sort(),
    );
    for (const source of Object.values(noorLifeAssets.modules)) {
      expect(source).toBeDefined();
      expect(source).not.toBeNull();
    }
  });

  it('gives every module a distinct asset', () => {
    const sources = Object.values(noorLifeAssets.modules).map((s) => JSON.stringify(s));
    expect(new Set(sources).size).toBe(sources.length);
  });

  it('resolves every entry-auth illustration', () => {
    for (const source of Object.values(noorLifeAssets.entryAuth)) {
      expect(source).toBeDefined();
      expect(source).not.toBeNull();
    }
  });

  it('reports the Google mark as absent rather than substituting one', () => {
    // Google's guidelines require their official multicolour "G" used unmodified. Until that file is
    // added the registry must say so — a stand-in shape would be a modified mark.
    expect(noorLifeAssets.brand.googleMark).toBeNull();
    expect(REQUIRED_GOOGLE_MARK_PATH).toBe('assets/brand/google/g-logo.png');
  });
});

describe('provider marks carry no placeholder', () => {
  const source = readFileSync(
    join(ROOT, 'src', 'features', 'entry-auth', 'components', 'social-auth-button.tsx'),
    'utf8',
  );

  it('draws no blue circle for Google', () => {
    // The rejected placeholder was a `#4285F4` disc built from borderRadius. Neither the colour nor a
    // hand-built round mark may reappear.
    expect(source).not.toMatch(/#4285F4/i);
    expect(source).not.toMatch(/borderRadius:\s*size\s*\/\s*2/);
  });

  it('draws no black square for Apple, and does not render Apple at all', () => {
    expect(source).not.toMatch(/#000000/);
    // Apple's own component owns that button; this one must not try to render it.
    expect(source).not.toMatch(/provider === 'apple' \?/);
  });
});

describe('medallion treatment', () => {
  it('defines a saturated fill for every module', () => {
    expect(Object.keys(medallionColors).sort()).toEqual(Object.keys(noorLifeAssets.modules).sort());
    for (const hex of Object.values(medallionColors)) {
      expect(hex).toMatch(/^#[0-9A-F]{6}$/i);
    }
  });

  it('matches the locked medallion colours', () => {
    expect(medallionColors.noorAI).toBe('#2563EB');
    expect(medallionColors.faith).toBe('#14966F');
    expect(medallionColors.health).toBe('#3B9DE2');
    expect(medallionColors.planner).toBe('#5B5BD6');
    expect(medallionColors.finance).toBe('#F59E0B');
    expect(medallionColors.learning).toBe('#7357D9');
    expect(medallionColors.family).toBe('#E84D78');
    expect(medallionColors.goals).toBe('#159E99');
  });

  it('sizes the pictogram inside the 74-78% band', () => {
    expect(medallionSpec.pictogramRatio).toBeGreaterThanOrEqual(0.74);
    expect(medallionSpec.pictogramRatio).toBeLessThanOrEqual(0.78);
  });
});
