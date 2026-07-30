import { render, screen } from '@testing-library/react-native';

import { getModulePictogram } from '@features/home/module-pictograms';
import { noorLifeAssets } from '@shared/assets/noorlife-assets';

import { moduleRegistry } from '../module-registry';
import { FRAMEWORK_MODULE_IDS } from '../module-tokens';
import { ModuleHomeScreen } from '../screens/module-home-screen';

/**
 * The Phase 4B corrections, asserted.
 *
 * Each block below corresponds to one numbered requirement in the correction brief. They are
 * behavioural rather than cosmetic: header *order*, asset *identity*, the absence of placeholder
 * copy. Appearance is settled by the screenshots; these stop a refactor from undoing the
 * corrections silently.
 */

/**
 * Header testIDs in rendered-tree order.
 *
 * The title layer is absolutely positioned and declared first so it sits *under* the controls
 * for hit-testing, which is why it leads the sequence; the controls then follow left to right.
 */
function headerTestIDs(prefix: string): string[] {
  const found: string[] = [];
  const walk = (node: unknown): void => {
    if (node === null || typeof node !== 'object') return;
    const candidate = node as { props?: Record<string, unknown>; children?: unknown[] };
    const id = candidate.props?.testID;
    if (typeof id === 'string' && id.startsWith(prefix) && id !== prefix) found.push(id);
    for (const child of candidate.children ?? []) walk(child);
  };
  walk(screen.getByTestId(prefix));
  return found;
}

/** The eight core modules, in the order the references are numbered. */
const EXPECTED_MODULES = [
  'noor-ai',
  'faith',
  'health',
  'planner',
  'finance',
  'learning',
  'family',
  'goals',
] as const;

describe('1 — exactly eight core modules exist', () => {
  it('registers all eight and nothing else', () => {
    expect([...FRAMEWORK_MODULE_IDS].sort()).toEqual([...EXPECTED_MODULES].sort());
    expect(FRAMEWORK_MODULE_IDS).toHaveLength(8);
  });

  it('includes Noor AI, which was previously treated as a placeholder', () => {
    expect(FRAMEWORK_MODULE_IDS).toContain('noor-ai');
    expect(moduleRegistry['noor-ai'].name).toBe('Noor AI');
  });
});

describe('2 — all eight heroes resolve to the locked hero PNGs', () => {
  it.each(EXPECTED_MODULES)('%s uses its own locked hero asset', (moduleId) => {
    const key = moduleId === 'noor-ai' ? 'noorAI' : moduleId;
    expect(moduleRegistry[moduleId].heroArtwork).toBe(noorLifeAssets.moduleHeroes[key]);
  });

  it('gives every module a distinct hero', () => {
    const sources = EXPECTED_MODULES.map((id) => JSON.stringify(moduleRegistry[id].heroArtwork));
    expect(new Set(sources).size).toBe(EXPECTED_MODULES.length);
  });
});

describe('3 — Noor AI renders no placeholder copy', () => {
  it('shows the approved screen, not a phase notice', async () => {
    await render(<ModuleHomeScreen moduleId="noor-ai" />);

    // The exact strings the placeholder used.
    expect(screen.queryByText(/arrives in Phase/i)).toBeNull();
    expect(screen.queryByText(/Phase 1 placeholder/i)).toBeNull();
    expect(screen.queryByText(/Phase 2/i)).toBeNull();

    // And the approved sections are present instead.
    for (const testID of [
      'noor-ai-hero',
      'noor-ai-ask',
      'noor-ai-capabilities',
      'noor-ai-suggestions',
      'noor-ai-conversations',
      'noor-ai-privacy',
    ]) {
      expect(screen.getByTestId(testID)).toBeTruthy();
    }
  });

  it('offers the four approved capability cards', async () => {
    await render(<ModuleHomeScreen moduleId="noor-ai" />);
    for (const label of ['Find a feature', 'Explain my progress', 'Help me plan', 'App settings']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it('labels its navigation as the reference does', () => {
    expect(moduleRegistry['noor-ai'].navigation.map((item) => item.label)).toEqual([
      'Home',
      'History',
      'Ask AI',
      'Saved',
      'Settings',
    ]);
  });
});

describe.each(EXPECTED_MODULES)('4 & 5 — header order: %s', (moduleId) => {
  it('renders Back, a centred title, then Help then Profile', async () => {
    await render(<ModuleHomeScreen moduleId={moduleId} />);
    const prefix = `${moduleId}-home-header`;

    const back = screen.getByTestId(`${prefix}-back`);
    const title = screen.getByTestId(`${prefix}-title`);
    const help = screen.getByTestId(`${prefix}-help`);
    const profile = screen.getByTestId(`${prefix}-profile`);
    for (const node of [back, title, help, profile]) {
      expect(node).toBeTruthy();
    }

    /*
     * Order is asserted by walking the rendered tree, not by reading coordinates: this
     * renderer performs no layout pass, so positions are all zero. Tree order is what the
     * header markup actually guarantees, and it is what changed in this correction.
     */
    const sequence = headerTestIDs(prefix);
    expect(sequence).toEqual(['-title', '-back', '-help', '-profile'].map((s) => prefix + s));
  });

  it('does not place the profile beside Back', async () => {
    await render(<ModuleHomeScreen moduleId={moduleId} />);
    const prefix = `${moduleId}-home-header`;
    const back = screen.getByTestId(`${prefix}-back`);
    const profile = screen.getByTestId(`${prefix}-profile`);

    // Back sits directly under the header row; Profile sits inside the right-hand cluster. If
    // they ever shared a parent, the profile would be back beside Back — the defect corrected.
    expect(profile.parent).not.toBe(back.parent);
  });

  it('centres the title across the whole header rather than the leftover space', async () => {
    await render(<ModuleHomeScreen moduleId={moduleId} />);
    const layer = screen.getByTestId(`${moduleId}-home-header-title`).parent;
    const styles = [layer?.props?.style].flat(3).filter(Boolean) as Record<string, unknown>[];
    // Absolutely positioned edge-to-edge, so the centre is the screen's centre.
    expect(styles.some((entry) => entry.position === 'absolute' && entry.left === 0 && entry.right === 0)).toBe(true);
  });
});

describe('6 — every raised centre control uses Main Home’s Noor AI asset', () => {
  const MAIN_HOME_MARK = getModulePictogram('noor-ai');

  it.each(EXPECTED_MODULES)('%s renders the same asset instance', async (moduleId) => {
    /*
     * Identity, not resemblance. The framework previously used
     * `noorLifeAssets.entryAuth.noorAiRobot` — a different file showing the same character —
     * which is why the centre robot differed between screens.
     */
    await render(<ModuleHomeScreen moduleId={moduleId} />);
    const mark = screen.getByTestId(`${moduleId}-home-nav-ai-mark`);
    expect(mark.props.source).toBe(MAIN_HOME_MARK);
    // Fitted rather than cropped, and never tinted.
    expect(mark.props.resizeMode).toBe('contain');
    const styles = [mark.props.style].flat(3).filter(Boolean) as Record<string, unknown>[];
    for (const entry of styles) {
      expect(entry.tintColor).toBeUndefined();
      expect(entry.backgroundColor).toBeUndefined();
    }
  });

  it('captions only the two modules whose references show one', () => {
    // Noor AI shows "Ask AI" and Faith shows "Faith AI"; the other six references show none.
    const captioned = EXPECTED_MODULES.filter((id) => moduleRegistry[id].showAICaption);
    expect([...captioned].sort()).toEqual(['faith', 'noor-ai']);
  });
});

describe('7 — Faith renders the prayer and time on one line', () => {
  it('holds them in a single string, so a wrap is impossible', async () => {
    await render(<ModuleHomeScreen moduleId="faith" />);
    const line = screen.getByTestId('faith-hero-prayer');
    expect(line.props.numberOfLines).toBe(1);
    expect(screen.getByText('Dhuhr 12:35 PM')).toBeTruthy();
    // Two separate fields is how they end up on two lines.
    expect(moduleRegistry.faith.hero.headline).toBe('Dhuhr 12:35 PM');
  });
});

describe('8 — hero copy is approved, concise, and never elided', () => {
  const REPLACED_SLOGANS = [
    'Today, in the order it happens',
    'Know where it went',
    'Pick up where you left off',
    'Everyone on the same page',
    'One step, repeated',
    'Small habits, tracked honestly',
    'Keep your day anchored in prayer',
  ];

  it.each(EXPECTED_MODULES)('%s carries no ellipsis in its hero copy', (moduleId) => {
    const hero = moduleRegistry[moduleId].hero;
    const strings = [
      hero.eyebrow,
      hero.headline,
      hero.headlineSuffix,
      hero.support,
      hero.supportSecondary,
      hero.actionLabel,
    ].filter((value): value is string => value !== undefined);

    for (const value of strings) {
      expect(value).not.toContain('…');
      expect(value).not.toContain('...');
    }
  });

  it('no longer uses any of the generic slogans it replaced', () => {
    const all = EXPECTED_MODULES.flatMap((id) => {
      const hero = moduleRegistry[id].hero;
      return [hero.eyebrow, hero.headline, hero.support, hero.supportSecondary];
    })
      .filter((value): value is string => value !== undefined)
      .join(' | ');

    for (const slogan of REPLACED_SLOGANS) {
      expect(all).not.toContain(slogan);
    }
  });

  it('gives every module an approved headline, and a CTA where the reference has one', () => {
    for (const id of EXPECTED_MODULES) {
      const hero = moduleRegistry[id].hero;
      expect(hero.headline.length).toBeGreaterThan(0);
      // Noor AI's reference has a question and a pill rather than a labelled figure with a
      // button, so it is the one module with no hero CTA.
      if (id === 'noor-ai') {
        expect(hero.actionLabel).toBe('');
      } else {
        expect(hero.actionLabel.length).toBeGreaterThan(0);
      }
    }
  });

  it('keeps Finance’s progress bar and its "62% spent" label on one value', () => {
    const hero = moduleRegistry.finance.hero;
    expect(hero.progress).toBe(0.62);
    expect(hero.support).toBe('62% spent');
  });
});
