import { render, screen } from '@testing-library/react-native';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';

import { getModulePictogram } from '@features/home/module-pictograms';
import { ModuleHomeScreen } from '@features/modules/screens/module-home-screen';
import { moduleLayout } from '@features/modules/module-tokens';
import { noorLifeAssets } from '@shared/assets/noorlife-assets';

import { FaithRepositoryProvider } from '../di/faith-repository-context';
import { faithRoutes } from '../faith-routes';
import { faithSubmenu } from '../faith-submenu-assets';

/**
 * The approved Faith assets are installed, resolved and rendered — with no fallback.
 *
 * Several of these read the filesystem rather than the render tree. That is deliberate:
 * "no chroma working file was bundled" and "the hero points at v2" are facts about what
 * ships, and a render assertion cannot establish either.
 */

const ASSET_DIR = path.join(process.cwd(), 'assets', 'images', 'modules', 'faith');
const SUBMENU_DIR = path.join(ASSET_DIR, 'submenu');

async function renderFaithHome() {
  await render(
    <FaithRepositoryProvider>
      <ModuleHomeScreen moduleId="faith" />
    </FaithRepositoryProvider>,
  );
  return screen;
}

describe('installed files', () => {
  it('has the new hero on disk', () => {
    expect(fs.existsSync(path.join(ASSET_DIR, 'faith-hero-left-copy-v2.png'))).toBe(true);
  });

  it('has all eight numbered submenu PNGs', () => {
    for (const name of [
      '01-quran',
      '02-hadith',
      '03-duas',
      '04-prayer',
      '05-qibla',
      '06-tasbih',
      '07-mosques',
      '08-calendar',
    ]) {
      expect({ name, present: fs.existsSync(path.join(SUBMENU_DIR, `${name}.png`)) }).toEqual({
        name,
        present: true,
      });
    }
  });

  it('bundles only those eight — no sprite sheet, no chroma working file', () => {
    const bundled = fs.readdirSync(SUBMENU_DIR);
    expect(bundled).toHaveLength(8);
    for (const file of bundled) {
      expect({ file, working: /chroma|sprite/i.test(file) }).toEqual({ file, working: false });
    }
  });
});

describe('the Faith hero', () => {
  it('resolves to the approved left-copy revision', () => {
    // Metro turns a `require` into a numeric id under Jest, so identity against a second
    // `require` of the same path is the check that the registry points where it claims.
    expect(noorLifeAssets.moduleHeroes.faith).toBe(
      require('@assets/images/modules/faith/faith-hero-left-copy-v2.png'),
    );
  });

  it('no longer resolves to the superseded symmetrical hero', () => {
    expect(noorLifeAssets.moduleHeroes.faith).not.toBe(
      require('@assets/images/modules/heroes/03-faith-hero.png'),
    );
  });
});

describe('the submenu registry', () => {
  it('holds the eight approved entries in the reference order', () => {
    expect(faithSubmenu.map((entry) => entry.key)).toEqual([
      'quran',
      'hadith',
      'duas',
      'prayer',
      'qibla',
      'tasbih',
      'mosques',
      'calendar',
    ]);
  });

  it('maps each entry to its numbered PNG', () => {
    const expected: Readonly<Record<string, unknown>> = {
      quran: require('@assets/images/modules/faith/submenu/01-quran.png'),
      hadith: require('@assets/images/modules/faith/submenu/02-hadith.png'),
      duas: require('@assets/images/modules/faith/submenu/03-duas.png'),
      prayer: require('@assets/images/modules/faith/submenu/04-prayer.png'),
      qibla: require('@assets/images/modules/faith/submenu/05-qibla.png'),
      tasbih: require('@assets/images/modules/faith/submenu/06-tasbih.png'),
      mosques: require('@assets/images/modules/faith/submenu/07-mosques.png'),
      calendar: require('@assets/images/modules/faith/submenu/08-calendar.png'),
    };
    for (const entry of faithSubmenu) {
      expect({ key: entry.key, source: entry.source }).toEqual({
        key: entry.key,
        source: expected[entry.key],
      });
    }
  });

  it('routes each tile to its Faith child screen', () => {
    const expected: Readonly<Record<string, string>> = {
      quran: faithRoutes.quran,
      hadith: faithRoutes.hadith,
      duas: faithRoutes.duas,
      prayer: faithRoutes.prayerTimes,
      qibla: faithRoutes.qibla,
      tasbih: faithRoutes.tasbih,
      mosques: faithRoutes.mosques,
      calendar: faithRoutes.calendar,
    };
    for (const entry of faithSubmenu) {
      expect({ key: entry.key, href: entry.href }).toEqual({
        key: entry.key,
        href: expected[entry.key],
      });
    }
  });

  it('gives every tile an accessible label', () => {
    for (const entry of faithSubmenu) {
      expect(entry.accessibilityLabel.length).toBeGreaterThan(3);
    }
  });

  it('declares no source as optional, so a fallback path cannot exist', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src', 'features', 'faith', 'faith-submenu-assets.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/source\?\s*:/);
    // Literal requires only — a template path would not resolve in a release bundle.
    expect(source).not.toMatch(/require\(\s*`/);
    expect(source).not.toMatch(/require\(\s*[A-Za-z_$]/);
  });
});

describe('the rendered submenu tiles', () => {
  it('renders an Image for all eight, not an icon glyph', async () => {
    const view = await renderFaithHome();
    for (const entry of faithSubmenu) {
      expect(await view.findByTestId(`faith-feature-${entry.key}-image`)).toBeTruthy();
    }
  });

  it('applies no tint and uses contain', async () => {
    const view = await renderFaithHome();
    for (const entry of faithSubmenu) {
      const image = await view.findByTestId(`faith-feature-${entry.key}-image`);
      expect(image.props.resizeMode).toBe('contain');
      expect(image.props.tintColor).toBeUndefined();
      const style = image.props.style;
      expect(style?.tintColor).toBeUndefined();
      expect(style?.backgroundColor).toBeUndefined();
      expect(style?.borderWidth).toBeUndefined();
    }
  });

  it('gives every pictogram an identical image box', async () => {
    const view = await renderFaithHome();
    const boxes = await Promise.all(
      faithSubmenu.map(async (entry) => {
        const image = await view.findByTestId(`faith-feature-${entry.key}-image`);
        return `${image.props.style.width}x${image.props.style.height}`;
      }),
    );
    expect(new Set(boxes).size).toBe(1);
  });

  it('sizes the image box large enough to read as artwork', () => {
    // The defect this replaces: a 27 dp glyph in a 48 dp tile, leaving a large empty band.
    expect(moduleLayout.faithSubmenuImage).toBeGreaterThanOrEqual(36);
    expect(moduleLayout.faithSubmenuTileHeight).toBeGreaterThanOrEqual(moduleLayout.minTouchTarget);
    // Image plus label plus gap must fit the tile.
    expect(moduleLayout.faithSubmenuImage + 15 + 3).toBeLessThanOrEqual(
      moduleLayout.faithSubmenuTileHeight,
    );
  });
});

describe('the bottom navigation robot', () => {
  it('is the same PNG identity Main Home uses', async () => {
    const view = await renderFaithHome();
    const mark = await view.findByTestId('faith-home-nav-ai-mark');
    // `RobotAsset` on Main Home resolves through the same `getModulePictogram('noor-ai')`,
    // so identity here proves one file rather than two that look alike.
    expect(mark.props.source).toBe(getModulePictogram('noor-ai'));
  });

  it('is not tinted', async () => {
    const view = await renderFaithHome();
    const mark = await view.findByTestId('faith-home-nav-ai-mark');
    expect(mark.props.tintColor).toBeUndefined();
    expect(mark.props.style?.tintColor).toBeUndefined();
  });
});
