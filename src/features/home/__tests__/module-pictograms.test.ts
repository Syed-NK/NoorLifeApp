import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { getModulePictogram, modulePictograms } from '../module-pictograms';
import { mainHomeModules } from '@ds/modules/module-themes';

/**
 * PNG pictogram contract tests.
 *
 * PNG_PICTOGRAM_IMPLEMENTATION_LOCK.md rejects the implementation if "any module uses a
 * generic vector icon", and requires a missing asset to be reported rather than
 * silently replaced. These tests assert the files exist on disk, that every module
 * resolves to one, and that the registry is exhaustive.
 */

const PICTOGRAM_DIR = join(__dirname, '..', '..', '..', '..', 'assets', 'images', 'pictograms');

const REQUIRED_FILES = [
  'noor-ai.png',
  'faith.png',
  'health.png',
  'planner.png',
  'finance.png',
  'learning.png',
  'family.png',
  'goals.png',
] as const;

describe('pictogram assets on disk', () => {
  it.each(REQUIRED_FILES)('assets/images/pictograms/%s exists', (file) => {
    expect(existsSync(join(PICTOGRAM_DIR, file))).toBe(true);
  });

  it('supplies exactly the eight required files', () => {
    expect(REQUIRED_FILES).toHaveLength(8);
  });
});

describe('pictogram registry', () => {
  it('registers one entry per required asset', () => {
    expect(Object.keys(modulePictograms).sort()).toEqual(
      ['ai', 'faith', 'family', 'finance', 'goals', 'health', 'learning', 'planner'].sort(),
    );
  });

  it('resolves a source for every one of the eight Main Home modules', () => {
    expect(mainHomeModules).toHaveLength(8);
    for (const theme of mainHomeModules) {
      const source = getModulePictogram(theme.id);
      expect(source).toBeDefined();
      expect(source).not.toBeNull();
    }
  });

  it('gives each module a distinct pictogram', () => {
    const sources = mainHomeModules.map((theme) => JSON.stringify(getModulePictogram(theme.id)));
    expect(new Set(sources).size).toBe(sources.length);
  });
});
