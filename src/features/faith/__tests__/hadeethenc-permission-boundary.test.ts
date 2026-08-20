import fs from 'node:fs';
import path from 'node:path';

import { PERMITTED_HADITH_PROVIDERS } from '../data/duas/reviewed-dua';

const ROOT = path.resolve(__dirname, '..');

describe('HadeethEnc permission boundary', () => {
  it('keeps every Hadith provider disabled until written permission is recorded', () => {
    expect(PERMITTED_HADITH_PROVIDERS).toEqual([]);
  });

  it('does not wire the adapter into production composition while permission is pending', () => {
    const composition = fs.readFileSync(
      path.join(ROOT, 'di', 'faith-repository-context.tsx'),
      'utf8',
    );
    expect(composition).not.toMatch(/hadeethenc|createHadeethEncRepository/i);
    expect(composition).toMatch(/createMockFaithRepositories/);
  });

  it('contains no vendor URL or network call in the mobile adapter', () => {
    const directory = path.join(ROOT, 'data', 'hadeethenc');
    const source = fs
      .readdirSync(directory)
      .filter((file) => file.endsWith('.ts'))
      .map((file) => fs.readFileSync(path.join(directory, file), 'utf8'))
      .join('\n');
    expect(source).not.toMatch(/https?:\/\/|\bfetch\s*\(/);
  });
});
