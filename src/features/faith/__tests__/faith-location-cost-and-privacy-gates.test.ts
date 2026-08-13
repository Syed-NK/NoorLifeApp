import fs from 'fs';
import path from 'path';

/**
 * The gates that keep Faith's location work free, offline and private — enforced rather than stated.
 *
 * ── Why these are tests and not a paragraph in a document ───────────────────
 * Every property below is a *negative*: no metered provider, no new secret, no coordinate leaving
 * the device, no test fixture reaching a release bundle. A negative cannot be verified by reading
 * the code that implements the feature, because the thing to look for is the code somebody has not
 * written yet. It has to be a scan that runs on every change, or it is a claim with a shelf life.
 *
 * ── What is deliberately *not* asserted here ────────────────────────────────
 * Three of the release brief's gates concern the bundled city catalogue: that searching makes no
 * network request, that the processed dataset carries no unnecessary personal data, and that the
 * GeoNames attribution and licence are recorded. No dataset has been approved or added, so there is
 * nothing to scan and a passing assertion would be vacuous — worse than absent, because it would
 * read as coverage. They belong with the importer, and are listed in the release report as owed.
 */

const ROOTS = {
  mobile: path.join(process.cwd(), 'src'),
  server: path.join(process.cwd(), 'supabase', 'functions'),
};

function listSourceFiles(root: string): readonly string[] {
  if (!fs.existsSync(root)) {
    return [];
  }
  const found: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      found.push(...listSourceFiles(full));
    } else if (/\.tsx?$/.test(entry.name)) {
      found.push(full);
    }
  }
  return found;
}

function relative(file: string): string {
  return path.relative(process.cwd(), file).split(path.sep).join('/');
}

const isTestFile = (file: string) =>
  /__tests__|[\\/]tests[\\/]|\.test\.tsx?$|_test\.ts$/.test(file);

/**
 * This file, excluded from its own scans.
 *
 * It has to name every forbidden hostname and credential in order to forbid them, so scanning it
 * finds all of them and always would. Excluding by exact path rather than by "skip test files":
 * a *different* test that starts naming `maps.googleapis` is a fact worth failing on, because the
 * usual reason a test names a provider hostname is that something now talks to it.
 */
const SCANNER = path.join(__dirname, 'faith-location-cost-and-privacy-gates.test.ts');

/**
 * Hostnames and SDK names that bill per request, per key, or per monthly active user.
 *
 * ── Why Nominatim and Overpass are on a *cost* list ─────────────────────────
 * They are free to call, so on price alone they do not belong here. They are listed because the
 * release brief forbids them as NoorLife's production backend for a different reason: both are
 * volunteer-funded shared infrastructure with usage policies that a shipped app's traffic would
 * breach, which makes "free" a cost borne by somebody else. The gate is about not acquiring an
 * external dependency for location, and that is what both would be.
 */
const METERED_PROVIDERS: readonly string[] = [
  'googleapis.com',
  'maps.google',
  'places.google',
  'maps.googleapis',
  'goo.gl/maps',
  'mapbox.com',
  'api.mapbox',
  'nominatim.openstreetmap',
  'overpass-api.de',
  'api.opencagedata',
  'locationiq.com',
  'api.tomtom.com',
  'geocode.xyz',
  'positionstack.com',
  'here.api',
  'react-native-maps',
  '@react-native-google',
];

/** Environment-variable shapes that would mean a new billable key had been introduced. */
const PROVIDER_KEY_PATTERNS: readonly RegExp[] = [
  /GOOGLE_[A-Z_]*API_KEY/,
  /GOOGLE_MAPS/,
  /GOOGLE_PLACES/,
  /MAPBOX_[A-Z_]*(?:TOKEN|KEY)/,
  /PLACES_API_KEY/,
  /GEOCOD(?:E|ING)_API_KEY/,
  /MAPS_API_KEY/,
];

describe('no metered location provider exists in mobile or server code', () => {
  const sources = [...listSourceFiles(ROOTS.mobile), ...listSourceFiles(ROOTS.server)].filter(
    (file) => file !== SCANNER,
  );

  it('is scanning both trees, so a mistyped root cannot pass silently', () => {
    expect(listSourceFiles(ROOTS.mobile).length).toBeGreaterThan(100);
    expect(listSourceFiles(ROOTS.server).length).toBeGreaterThan(10);
  });

  it('names no paid or shared-infrastructure place provider anywhere', () => {
    const offenders: string[] = [];

    for (const file of sources) {
      const source = fs.readFileSync(file, 'utf8');
      for (const provider of METERED_PROVIDERS) {
        if (source.includes(provider)) {
          offenders.push(`${relative(file)} → ${provider}`);
        }
      }
    }

    /*
      Deliberately scans comments too. A commented-out Google Places call is a hostname somebody
      intends to restore, and the point of this gate is to make that a conversation rather than a
      quiet re-introduction of a bill.
    */
    expect(offenders).toEqual([]);
  });

  it('declares no map, places or geocoding dependency in the manifest', () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'),
    ) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    const named = [...Object.keys(manifest.dependencies), ...Object.keys(manifest.devDependencies)];

    /*
      `@expo-google-fonts/poppins` matches on "google" and is not a location provider — it is the
      OFL-licensed Poppins family, vendored as a package and loaded from the bundle. It makes no
      network request and carries no key. Excluded by exact name rather than by loosening the
      pattern, so a genuine `@react-native-google-places` could never hide behind the same word.
    */
    const FONT_PACKAGE = '@expo-google-fonts/poppins';

    expect(
      named
        .filter((name) => name !== FONT_PACKAGE)
        .filter((name) => /google|maps|mapbox|places|geocod/i.test(name)),
    ).toEqual([]);
  });

  it('introduces no new provider key or secret', () => {
    const offenders: string[] = [];

    for (const file of [...sources, path.join(process.cwd(), 'app.json')]) {
      if (!fs.existsSync(file) || file === SCANNER) {
        continue;
      }
      const source = fs.readFileSync(file, 'utf8');
      for (const pattern of PROVIDER_KEY_PATTERNS) {
        if (pattern.test(source)) {
          offenders.push(`${relative(file)} → ${pattern.source}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});

describe('a coordinate is never uploaded to compute what can be computed locally', () => {
  /**
   * The three calculations the brief names, and the modules that own them.
   *
   * Each is pure arithmetic over a coordinate — spherical trigonometry for the Qibla, the `adhan`
   * library for prayer times, a bundled polygon raster for the timezone. None of them needs a
   * server, so the gate is simply that none of them *has* one: a module with no transport cannot
   * send a coordinate anywhere, regardless of what a future call site asks it to do.
   */
  const CALCULATORS: readonly string[] = [
    'src/features/faith/data/qibla/qibla.ts',
    'src/features/faith/data/qibla/qibla-bearing.repository.ts',
    'src/features/faith/data/prayer/adhan-prayer-times.repository.ts',
    'src/features/faith/data/prayer/location-time-zone.ts',
    'src/features/faith/data/hijri/hijri-calendar.ts',
    'src/features/faith/storage/prayer-location-store.ts',
  ];

  it.each(CALCULATORS)('%s reaches no network transport', (file) => {
    const source = fs
      .readFileSync(path.join(process.cwd(), file), 'utf8')
      // Comments discuss the network at length — deliberately, since explaining what was rejected is
      // most of these files' documentation. The rule is about code.
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/XMLHttpRequest|WebSocket|axios/);
    expect(source).not.toMatch(/https?:\/\//);
    expect(source).not.toMatch(/supabase|\.functions\.invoke/i);
  });
});

describe('no coordinate or search term is written to a log', () => {
  const faithSources = listSourceFiles(path.join(process.cwd(), 'src', 'features', 'faith')).filter(
    (file) => !isTestFile(file),
  );

  it('logs no latitude, longitude or coordinate value from Faith production code', () => {
    const offenders: string[] = [];

    for (const file of faithSources) {
      const source = fs.readFileSync(file, 'utf8');
      /*
        Every `console.*` call with its argument list, brace-counted for the same reason the
        propagation scan counts: a log line can contain a template literal containing an expression.
      */
      for (const match of source.matchAll(/console\.\w+\(/g)) {
        const start = (match.index ?? 0) + match[0].length;
        let depth = 1;
        let cursor = start;
        while (cursor < source.length && depth > 0) {
          const char = source[cursor];
          if (char === '(') depth += 1;
          else if (char === ')') depth -= 1;
          cursor += 1;
        }
        const args = source.slice(start, cursor - 1);
        if (/latitude|longitude|coordinate|\blat\b|\blon\b|\blng\b/i.test(args)) {
          offenders.push(`${relative(file)} → console(${args.trim().slice(0, 60)})`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('sends no coordinate to an analytics or telemetry sink, because none exists', () => {
    const offenders = faithSources.filter((file) =>
      /\b(?:analytics|telemetry|trackEvent|logEvent|Sentry|amplitude|mixpanel)\b/i.test(
        fs.readFileSync(file, 'utf8'),
      ),
    );

    expect(offenders.map(relative)).toEqual([]);
  });
});

describe('production code imports no test support', () => {
  it('keeps fixtures, fakes and seeds out of every shipped module', () => {
    const offenders: string[] = [];

    for (const file of listSourceFiles(ROOTS.mobile)) {
      if (isTestFile(file) || relative(file).startsWith('src/test-support/')) {
        continue;
      }
      const source = fs.readFileSync(file, 'utf8');
      for (const match of source.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
        const specifier = match[1] ?? '';
        if (/test-support|__tests__|\.fixtures?$|\/fakes?\//.test(specifier)) {
          offenders.push(`${relative(file)} → ${specifier}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});

describe('Quran Foundation credentials stay server-side', () => {
  it('holds no client id or secret in any shipped mobile module', () => {
    /*
      Production files only. A test that *asserts* the mobile bundle carries no secret has to name
      the thing it is looking for, and failing on that would make the property untestable — the
      scan would forbid its own evidence. Test files are excluded here and covered by the rule
      below instead, which is about where the value is actually read.
    */
    const offenders = listSourceFiles(ROOTS.mobile)
      .filter((file) => !isTestFile(file) && file !== SCANNER)
      .filter((file) =>
        /QF_CLIENT_(?:ID|SECRET)|client_secret|clientSecret/.test(fs.readFileSync(file, 'utf8')),
      )
      .map(relative);

    expect(offenders).toEqual([]);
  });

  it('reads the secret from the environment in exactly one server file', () => {
    /**
     * `Deno.env.get`, not the identifier.
     *
     * The name `QF_CLIENT_SECRET` appears in five server files — in the doc comments explaining what
     * the parameter is and where it comes from, which is exactly the documentation that should
     * exist. Matching the identifier therefore measures prose, not behaviour. What matters is which
     * file *reads the environment*: that is the one place the real value enters the process, and
     * everything downstream receives it as a parameter it cannot widen.
     */
    const readers = listSourceFiles(ROOTS.server)
      .filter((file) => !isTestFile(file))
      .filter((file) =>
        /Deno\.env\.get\(\s*['"]QF_CLIENT_SECRET['"]\s*\)/.test(fs.readFileSync(file, 'utf8')),
      )
      .map(relative);

    expect(readers).toEqual(['supabase/functions/quran-content/index.ts']);
  });

  it('never puts the secret in a URL, a log or a response', () => {
    const tokenStore = fs.readFileSync(
      path.join(process.cwd(), 'supabase/functions/quran-content/token-store.ts'),
      'utf8',
    );
    /*
      The secret's one legitimate destination is the Basic credential in an Authorization header.
      Anything that would place it in a query string or a log line is the leak this asserts against.
    */
    expect(tokenStore).not.toMatch(/console\.\w+\([^)]*(?:clientSecret|credential)/);
    expect(tokenStore).not.toMatch(/[?&][a-z_]*secret=/i);
  });
});
