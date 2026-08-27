import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * **A placeholder may say what is planned. It may not say what already happened.** — issue #37.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── The defect ─────────────────────────────────────────────────────────────
 * `ModuleSectionScreen` is the framework's honest "not yet" shell, and the parts of it the framework
 * controls were already right: a banner reading *"«Title» arrives with the «Module» module's full
 * release"*, a hero with `hideAction` so there is no call to action, an empty state saying *"When
 * «Title» is built, your activity will appear here"*, and one CTA — "Ask «AI»" — pointing at a route
 * that works.
 *
 * What was wrong was the copy each route passed *into* it. Nineteen screens across six modules
 * described unavailable functionality in the present or perfect tense, and several asserted the user
 * already had data: *"Every question you have asked"*, *"Everything you have logged, in one place"*,
 * *"What you have kept and what you have missed"*, *"The streaks you kept and the goals you closed"*.
 *
 * The worst was `ai/permissions`: *"You decide what Noor AI can read — grant a module, or withdraw it,
 * at any time."* No grant store exists anywhere in the codebase, so that describes a **privacy
 * control** the user cannot exercise. A missing feature is a disappointment; a privacy control someone
 * believes they used is a different kind of harm.
 *
 * ── Why this enumerates the filesystem ─────────────────────────────────────
 * Because the defect was uniform across nineteen files and would be uniform across the twentieth. A
 * hand-maintained list would have to be remembered; a directory walk cannot be. Every route rendering
 * the shell is discovered and held to the same rule, so a new placeholder is covered by construction.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const APP_ROOT = join(__dirname, '..', '..', '..', 'app');

/** Every route file under `src/app`, relative, discovered rather than listed. */
function routeFiles(): readonly string[] {
  const found: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full, prefix === '' ? entry : `${prefix}/${entry}`);
        continue;
      }
      if (entry.endsWith('.tsx')) {
        found.push(prefix === '' ? entry : `${prefix}/${entry}`);
      }
    }
  };
  walk(APP_ROOT, '');
  return found;
}

function source(relative: string): string {
  return readFileSync(join(APP_ROOT, relative), 'utf8');
}

/** Comment-stripped, so a docblock quoting the old copy cannot fail an assertion about shipping it. */
function code(relative: string): string {
  return source(relative)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

/** Every route that renders the placeholder shell. */
function sectionScreenRoutes(): readonly string[] {
  return routeFiles().filter((file) => code(file).includes('ModuleSectionScreen'));
}

type Copy = { readonly route: string; readonly title: string; readonly body: string };

function copyOf(route: string): Copy {
  const body = code(route);
  const title = /heroTitle="([^"]+)"/.exec(body);
  const support = /heroBody="([^"]+)"/.exec(body);
  return { route, title: title?.[1] ?? '', body: support?.[1] ?? '' };
}

const ROUTES = sectionScreenRoutes();
const ALL_COPY = ROUTES.map(copyOf);

describe('the placeholder routes are discovered, not listed', () => {
  it('finds every ModuleSectionScreen route by walking src/app', () => {
    /*
      Nineteen at the time of writing. Asserted as a floor rather than an equality: adding a
      placeholder is normal, and the cases below hold it to the rule. Dropping below nineteen would
      mean a screen became real or disappeared, which is worth a deliberate look.
    */
    /* Eighteen since #93 built Spending. A floor, so a new placeholder still inherits the rule. */
    expect(ROUTES.length).toBeGreaterThanOrEqual(18);
  });

  it('gives every one of them a headline and a supporting line to check', () => {
    for (const copy of ALL_COPY) {
      expect(copy.title.length).toBeGreaterThan(0);
      expect(copy.body.length).toBeGreaterThan(0);
    }
  });

  it('keeps the copy short enough to survive a large font', () => {
    /*
      Measured, not guessed. `ModuleHeroCard` renders the headline at `numberOfLines={1}` and the
      support at `{2}`, in a copy column that holds a little over half the hero because the artwork
      takes the rest. On a physical device at font scale 1.3 that left about thirteen characters of
      headline and two short lines of body — the first version of this copy showed "A list of en…" and
      "Not built yet. What you record will ap…".

      These bounds are the observed budget with a little room. They are deliberately generous rather
      than exact: the aim is to stop a sentence being pasted in here, not to police a character count.
      Truncation is not a correctness bug — the "Not built yet." lead means a clipped line loses the
      promise and never the caveat — but a headline cut mid-word is simply poor.
    */
    for (const copy of ALL_COPY) {
      expect(copy.title.length).toBeLessThanOrEqual(24);
      expect(copy.body.length).toBeLessThanOrEqual(64);
    }
  });
});

describe('every placeholder says it is unavailable', () => {
  /**
   * The explicit signal, in the supporting line.
   *
   * One phrase rather than a family of them, deliberately: a reader learns to recognise it, and a
   * test that accepted any of six near-synonyms would drift into accepting a seventh that hedged.
   * The headline carries the variety; this carries the fact.
   */
  const UNAVAILABLE_LEAD = 'Not built yet.';

  it.each(ALL_COPY.map((c) => [c.route, c.body] as const))(
    '%s leads with the unavailable statement',
    (_route, body) => {
      expect(body.startsWith(UNAVAILABLE_LEAD)).toBe(true);
    },
  );

  it.each(ALL_COPY.map((c) => [c.route, c.title] as const))(
    '%s uses future or planned language in its headline',
    (_route, title) => {
      /*
        A headline is one line — `ModuleHeroCard` renders it at `numberOfLines={1}` — so it cannot
        carry the whole caveat. What it must not do is read as a statement of fact about something
        that exists, so it has to contain a future marker.
      */
      expect(title).toMatch(/\bplanned\b|\bwill\b|\byet\b|\bsoon\b/i);
    },
  );
});

describe('no placeholder claims the user already has data', () => {
  /*
    The perfect tense is the tell. "Everything you have logged", "every question you have asked",
    "the streaks you kept" — each asserts a record that does not exist, and each was on a screen whose
    own banner said the feature had not shipped.
  */
  const CLAIMS_DATA = [
    /you have (logged|asked|saved|started|finished|kept|set aside|missed)/i,
    /everything you have/i,
    /every (question|entry) you/i,
    /(streaks|goals|lessons|courses|entries|answers|photos) you (kept|closed|saved|started|asked)/i,
    /your (history|records|entries|conversations|budgets) (is|are) /i,
  ];

  it.each(ALL_COPY.map((c) => [c.route, `${c.title} | ${c.body}`] as const))(
    '%s asserts no existing record',
    (_route, spoken) => {
      for (const pattern of CLAIMS_DATA) {
        expect(spoken).not.toMatch(pattern);
      }
    },
  );
});

describe('no placeholder claims a working control', () => {
  /*
    The second group in the audit: copy that describes a setting, limit or permission as something the
    user operates today. Present-tense imperatives are the giveaway — "Set an amount per category",
    "Grant a module, or withdraw it" — because an instruction implies the thing can be done.
  */
  it.each(ALL_COPY.map((c) => [c.route, `${c.title} | ${c.body}`] as const))(
    '%s issues no instruction it cannot honour',
    (_route, spoken) => {
      // A leading imperative in either line.
      expect(spoken).not.toMatch(/(^|\| )(set|grant|withdraw|choose|change|turn on|turn off)\b/i);
      expect(spoken).not.toMatch(/at any time/i);
      expect(spoken).not.toMatch(/changeable/i);
    },
  );
});

describe('the AI permission claim specifically', () => {
  const ROUTE = 'ai/permissions.tsx';

  it('is one of the discovered placeholder routes', () => {
    expect(ROUTES).toContain(ROUTE);
  });

  it('never says the user can grant or withdraw a module', () => {
    /*
      Named and forbidden on its own, rather than left to the general rules, because it is the one
      claim in this issue that could make somebody believe they had exercised a privacy control. The
      exact sentence that shipped is asserted absent, and so is any rephrasing of it.
    */
    const spoken = copyOf(ROUTE);
    const both = `${spoken.title} | ${spoken.body}`;
    expect(both).not.toContain('Grant a module, or withdraw it, at any time.');
    expect(both).not.toContain('You decide what Noor AI can read');
    expect(both).not.toMatch(/\b(grant|granted|withdraw|revoke|revoked)\b/i);
    expect(both).not.toMatch(/you (decide|control|manage)\b/i);
  });

  it('has no grant store behind it to describe', () => {
    /*
      The finding, asserted rather than trusted. `ai-scope.ts` is a pure policy function — it answers
      "may this module be read" from the request context and the plan — and it persists nothing. If a
      real grant store is ever added, this fails and the copy can be revisited deliberately.
    */
    const scope = readFileSync(
      join(__dirname, '..', '..', '..', 'shared', 'permissions', 'ai-scope.ts'),
      'utf8',
    );
    expect(scope).not.toMatch(/AsyncStorage|SecureStore|setItem|getItem/);
  });
});

describe('a placeholder can change nothing', () => {
  it.each(ROUTES)('%s imports only the shell', (route) => {
    /*
      The strongest guarantee available here, and cheap: each of these files is one import and a
      handful of copy props. A repository, a network client, an AI call, storage parsing or an account
      key would all be visible in the import list.
    */
    const body = code(route);
    expect(body).not.toMatch(/Repository|repository|AsyncStorage|SecureStore|JSON\.parse/);
    expect(body).not.toMatch(/fetch\(|axios|supabase|https?:\/\//);
    expect(body).not.toMatch(/noorlife\.|ownerId|userId/);
    expect(body).not.toMatch(/useState|useEffect|onPress|setItem/);
  });

  it.each(ROUTES)('%s mutates no permission or entitlement', (route) => {
    const body = code(route);
    expect(body).not.toMatch(/requestPermission|grantRecovery|setEntitlement|Notifications/);
  });
});

describe('the shell and the navigation are untouched', () => {
  const shell = readFileSync(join(__dirname, '..', 'screens', 'module-section-screen.tsx'), 'utf8');

  it('keeps the self-identifying banner', () => {
    expect(shell).toContain('ModuleStatusBanner');
    expect(shell).toContain('arrives with the ');
  });

  it('keeps the hero action suppressed, so no CTA names an unavailable feature', () => {
    // The one CTA on these screens is the empty state's, and it points at the module AI, which works.
    expect(shell).toContain('hideAction');
    expect(shell).toContain('definition.routes.ai');
  });

  it('keeps every route title, so navigation still reads the same', () => {
    /*
      The copy changed; the destinations and their names did not. `title` drives the header and the
      hero eyebrow, and it is what the locked bottom navigation points at.
    */
    const titles = ROUTES.map((route) => /title="([^"]+)"/.exec(code(route))?.[1]);
    expect(titles.filter((t) => t === undefined)).toEqual([]);
    expect(titles).toContain('AI Permissions');
    expect(titles).toContain('Track');
    expect(titles).toContain('Trends');
    expect(titles).toContain('Records');
  });
});
