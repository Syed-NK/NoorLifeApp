import { render, screen } from '@testing-library/react-native';

import { getModulePictogram } from '@features/home/module-pictograms';
import { noorLifeAssets } from '@shared/assets/noorlife-assets';
import { installMockLatencyTimers } from '@/test-support/mock-latency-timers';

import { moduleRegistry } from '../module-registry';
import { FRAMEWORK_MODULE_IDS } from '../module-tokens';
import { ModuleHomeScreen } from '../screens/module-home-screen';

// Mounts screens backed by simulated-latency mocks. Advancing those timers rather than
// sleeping through them is what keeps this suite inside Jest's default per-test budget.
installMockLatencyTimers();

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
  it.each(EXPECTED_MODULES)('%s uses its own locked hero asset, or none', (moduleId) => {
    /*
      Health registers none, by issue #27: `04-health-hero.png` draws a rising line chart with
      plotted node markers, which reads as the user’s health trend on a screen stating no health
      source exists. Unregistered rather than cropped — `cover` gives no crop, and an offset would
      depend on the aspect ratio.
    */
    if (moduleId === 'health') {
      expect(moduleRegistry.health.heroArtwork).toBeUndefined();
      return;
    }
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

    // And the sections this build can honestly serve are present instead.
    for (const testID of ['noor-ai-hero', 'noor-ai-ask', 'noor-ai-privacy']) {
      expect(screen.getByTestId(testID)).toBeTruthy();
    }
  });

  /**
   * The capability grid, the suggestions and the conversation list were removed after AI-5's emulator
   * pass: four of those controls described Noor AI reading module records it cannot read, one routed
   * to "coming soon", and the conversation list was three invented questions with invented
   * timestamps. `noor-ai-home-capability-boundary.test.tsx` is where that boundary is now asserted in
   * full; this row only records that the phase-4b placeholder removal still holds without them.
   */
  it('offers the ask entry and the access card, and no capability grid', async () => {
    await render(<ModuleHomeScreen moduleId="noor-ai" />);

    expect(screen.getByTestId('noor-ai-ask-field')).toBeTruthy();
    expect(screen.getByTestId('noor-ai-ask-send')).toBeTruthy();
    expect(screen.queryByTestId('noor-ai-capabilities')).toBeNull();
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
    /*
      `-title-band` is the layer the title sits in, and it is first because the title is drawn
      beneath the controls rather than between them. It became addressable when the band stopped
      spanning the header edge to edge and started reserving room for the control clusters — see
      `headerTitleBandWidth`. The order the correction is about is unchanged: title layer, Back,
      Help, Profile.
    */
    const sequence = headerTestIDs(prefix);
    expect(sequence).toEqual(
      ['-title-band', '-title', '-back', '-help', '-profile'].map((s) => prefix + s),
    );
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
    const layer = screen.getByTestId(`${moduleId}-home-header-title-band`);
    const style = Object.assign(
      {},
      ...[layer.props.style].flat(3).filter((entry) => entry !== null && typeof entry === 'object'),
    ) as Record<string, unknown>;

    /*
      ── What the invariant is, and what it is not ─────────────────────────────
      It used to be asserted as `left === 0 && right === 0` — the title layer spanning the header
      edge to edge. That was *one implementation* of centring on the screen, and it has been
      replaced by another: the layer now reserves the wider control cluster on both sides, so the
      title fills a band instead of shrinking to its own measured string. (The measurement is the
      defect — a deep link mounts a module screen before Poppins is registered, and a content-sized
      box keeps the fallback face's width for ever. See `module-header.tsx`.)

      What the correction actually requires survives both: **equal insets**. Back is one control and
      Help plus Profile are two, so any layout that reserves each side its own width centres the
      title on the midpoint between the clusters, which sits left of the screen's centre. Equal
      insets — of any size, including zero — put the band's centre on the screen's centre.
    */
    expect(style.position).toBe('absolute');
    expect(typeof style.left).toBe('number');
    expect(style.left).toBe(style.right);
    // And the child fills that band rather than being sized by the string inside it.
    expect(style.alignItems).toBe('stretch');
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

describe('7 — Faith renders the prayer and time as one unit', () => {
  it('holds them in a single string, so they cannot be split across fields', async () => {
    await render(<ModuleHomeScreen moduleId="faith" />);
    const line = screen.getByTestId('faith-hero-prayer');

    /**
     * ── What this case still asserts, and what it deliberately no longer does ──
     * The correction it was written for is that the prayer and its time are **one node**: two
     * separate fields is how they end up on two lines with the time orphaned below the name. That
     * is unchanged and is asserted below.
     *
     * The hard `numberOfLines === 1` that used to sit here is gone. It was the mechanism, not the
     * requirement, and it is the mechanism that shipped `Times for where …` — the headline is not
     * always a prayer line, and capping every headline at one line to keep one of them tidy cost
     * the meaning of another. `faith-hero-layout.test.tsx` now covers the replacement rule: shrink,
     * then wrap, and never truncate.
     */

    /*
      The prayer and its time are one node, which is the correction this case was written for: two
      separate fields is how they end up on two lines. The *content* is no longer asserted here —
      it used to be the literal `Dhuhr 12:35 PM`, which was a fixture rendered to every user on
      every day. `faith-hero-layout.test.tsx` covers both the live and the fallback copy, and that
      the static copy names no time at all.
    */
    expect(typeof line.props.children).toBe('string');
    expect(String(line.props.children).length).toBeGreaterThan(0);
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
      /*
        Two modules ship an empty label now. Noor AI's reference has a question and a pill rather
        than a labelled figure with a button; Health has no working destination to name, so issue
        #27 removed its CTA rather than point it at a placeholder.
      */
      if (id === 'noor-ai' || id === 'health') {
        expect(hero.actionLabel).toBe('');
      } else {
        expect(hero.actionLabel.length).toBeGreaterThan(0);
      }
    }
  });

  /*
    Was: "keeps Finance’s progress bar and its '62% spent' label on one value". Both halves were
    hard-coded — 0.62 and "62% spent" agreed with each other and with nothing else, drawing a
    part-filled bar about a budget the user had never set (issue #23). The invariant that replaced it
    is the one worth asserting: a module with no data layer behind it states no figure at all.
  */
  it('states no figure in a hero that has no source behind it', () => {
    for (const id of ['finance', 'learning', 'family', 'goals'] as const) {
      const hero = moduleRegistry[id].hero;
      expect(hero.progress).toBeUndefined();
      expect(hero.headlineSuffix).toBeUndefined();
      expect(`${hero.headline} ${hero.support ?? ''}`).not.toMatch(/[0-9]/);
    }
  });
});
