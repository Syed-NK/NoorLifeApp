import fs from 'node:fs';
import path from 'node:path';

/**
 * Nothing in the Faith module states a fact it has not derived.
 *
 * ── Why a source scan, and why this directory ───────────────────────────────
 * The Faith home rendered from a module constant called `faithHomeFixture` for several phases. It
 * held a next prayer ("Dhuhr 12:35 PM"), a Gregorian date ("May 19, 2025"), a Hijri date, five
 * prayer times, a Ramadan countdown ("In 296 days"), a verse of the Qur'an in Arabic, and a line of
 * religious guidance captioned "Source: Sahih Bukhari". Every one of those rendered to every user on
 * every day as though it were their own state.
 *
 * None of it was caught by the existing scans, and the reason is worth recording: they walk
 * `src/features/faith/`, and the Faith home composition lives in `src/features/modules/faith/`,
 * one directory outside. The integrity rules were sound and the boundary they were checked over was
 * drawn a directory too small. **This file scans both.**
 *
 * ── What it can and cannot establish ────────────────────────────────────────
 * It cannot prove a value was derived — that is what the screen and repository tests do. What it can
 * do is catch the specific shape the defect took: a literal in a source file that reads like a fact
 * about today. A date, a clock time, a prayer name paired with a time, or a run of Arabic script
 * outside the places scripture is legitimately handled.
 *
 * Comments are stripped first, so the prose above — which necessarily quotes every string it
 * forbids — is not what fails the scan.
 */

const REPO_ROOT = process.cwd();

/**
 * Both halves of the Faith module.
 *
 * `src/features/modules/faith/` is the composition — the hero and the home content. It is outside
 * the Faith feature directory because it is built on the shared module framework, and that
 * architectural split is exactly what let a fixture live unscanned for several phases.
 */
const SCANNED_DIRS: readonly string[] = [
  path.join(REPO_ROOT, 'src', 'features', 'faith'),
  path.join(REPO_ROOT, 'src', 'features', 'modules', 'faith'),
  /**
   * Main Home, and the dashboard fixture it renders from.
   *
   * Added because the boundary was drawn a directory too small a second time. Main Home showed
   * "12:35 PM · Dhuhr Prayer" — the exact literal the deleted prayer-times fixture returned — from
   * `src/mocks/main-home.ts`, while the Faith module a tap away calculated 1:14 PM for the same
   * place. One app, two claims about the same prayer, and neither directory above could see it.
   */
  path.join(REPO_ROOT, 'src', 'features', 'home'),
  path.join(REPO_ROOT, 'src', 'mocks'),
  /**
   * The shared module-overview fixtures.
   *
   * `services/mock-module-repository.ts` held four fabricated prayer times with `done`/`due`
   * completion states and the claim "You have kept every Fajr this week". It is reachable from the
   * `/module-gallery` and `/hero-audit` routes, so it is app surface rather than test data.
   */
  path.join(REPO_ROOT, 'src', 'features', 'modules', 'services'),
];

function sourceFiles(dir: string): readonly string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Tests legitimately contain the strings they assert the absence of.
      return entry.name === '__tests__' ? [] : sourceFiles(full);
    }
    return entry.name.endsWith('.ts') || entry.name.endsWith('.tsx') ? [full] : [];
  });
}

/** Executable text only, so a comment explaining a prohibition is not what fails a scan. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const ALL_FILES = SCANNED_DIRS.flatMap(sourceFiles);

function relative(file: string): string {
  return path.relative(REPO_ROOT, file).replace(/\\/g, '/');
}

/**
 * Files permitted to contain Arabic script, and the reason for each.
 *
 * Deliberately short, and each entry is a place where Arabic is *data the user supplied or a fixture
 * that is labelled as one* rather than scripture presented as verified. The approved adapter and the
 * daily-verse rotation are absent from this list because they hold no Arabic at all — the rotation
 * stores surah and ayah numbers, and the adapter copies whatever the response carried.
 */
const ARABIC_ALLOWED: readonly string[] = [
  // Sample scripture, stamped `MOCK_SOURCE` and rendered under a "not a verified source" warning.
  'src/features/faith/data/mock/mock-quran.repository.ts',
  /*
    `mock-hadith.repository.ts` and `mock-dua.repository.ts` were on this list and are now deleted.
    They held graded narrations with real references and Arabic supplications rendered at display
    size, and the exemption is what let them pass this scan for several phases — an allow-list entry
    is a decision to stop checking, so it is worth recording that the decision was reversed rather
    than the files quietly disappearing from the array. The Hadith and Duas screens are locked
    states now; see `data/unconfigured-content.repository.ts`.
  */
  // Dhikr phrases. The user's own remembrance, not scripture quoted as a source.
  /*
    `mock-faith-ai.repository.ts` was exempted here and is not any more. It held Qur'an 94:6 in Arabic
    referenced as "Surah Ash-Sharh 94:6" and a narration attributed to "Sahih al-Bukhari 6464". The
    old justification was that the assistant could only quote from a frozen set — true, and beside the
    point: both entries named a real source nobody had verified, and the exemption is what let them sit
    unscanned. The quote set is deleted rather than shortened, so the file now passes this scan on its
    own merits with no entry needed.
  */
];

/** Arabic letters, excluding the presentation forms no source file should contain. */
const ARABIC_SCRIPT = /[ء-ي]/;

describe('no Arabic scripture is held as a source literal', () => {
  it.each(ALL_FILES.map(relative))('%s', (file) => {
    if (ARABIC_ALLOWED.includes(file)) {
      return;
    }
    const source = stripComments(fs.readFileSync(path.join(REPO_ROOT, file), 'utf8'));
    /*
      The specific defect: `faith-view-model.ts` carried Qur'an 94:6 as a string literal in the JS
      bundle, unattributed, from no approved source — inside the module whose entire architecture
      exists to keep scripture behind a licensed boundary.
    */
    expect(source).not.toMatch(ARABIC_SCRIPT);
  });

  it('scans a directory set that includes the composition, not only the feature', () => {
    // The assertion that this test is looking where the defect actually was.
    const scanned = ALL_FILES.map(relative);
    expect(scanned.some((file) => file.startsWith('src/features/modules/faith/'))).toBe(true);
    expect(scanned.some((file) => file.startsWith('src/features/faith/'))).toBe(true);
  });
});

describe('no Faith source states a date, a time or a countdown as a literal', () => {
  /**
   * Files whose literals are legitimately date-shaped, and why.
   *
   * The Hijri modules name months and the tabular calendar's constants; the prayer-time fixture
   * carries the sample times it exists to be. Both are data, not claims rendered as the user's own —
   * and both are covered by their own tests.
   */
  const DATE_ALLOWED: readonly string[] = [
    'src/features/faith/data/hijri/hijri-calendar.ts',
    'src/features/faith/data/hijri/hijri-observances.ts',
    'src/features/faith/data/hijri/hijri-calendar.repository.ts',
    // `mock-prayer-times.repository.ts` was here and is deleted; the times are calculated now.
    'src/features/faith/data/mock/mock-worship.repository.ts',
    /**
     * The shared module-overview fixtures — exempt from the *clock-time* rule only, and narrowly.
     *
     * Faith's entry in this file is empty now: its four fabricated prayer times, their `done`/`due`
     * completion states and the "You have kept every Fajr this week" insight are all deleted. What
     * remains are clock literals belonging to **other** modules' preview fixtures — Planner's
     * `9:30 am` stand-up, Health's `8:30 pm`, Family's `Friday, 7:00 pm` and so on.
     *
     * Those are outside this brief. Extending a Faith integrity scan into a hard failure on seven
     * other modules' fixtures would either block this work or force seven product decisions nobody
     * has asked for, so the file is exempted from this one rule and flagged for a later pass. It stays
     * subject to every other rule here — Arabic script, hadith citations, surah references and
     * scholarly claims all still fail on it, which are the rules that matter for religious content.
     *
     * `the module overview states nothing about the user's worship` below is the assertion that keeps
     * Faith's own entry honest despite this exemption.
     */
    'src/features/modules/services/mock-module-repository.ts',
    /**
     * Main Home's dashboard fixture — exempt from the *clock-time* rule only.
     *
     * The Faith row is gone from this file: `{ time: '12:35 PM', title: 'Dhuhr Prayer' }` is deleted
     * and supplied by `usePrayerTimelineEntry` from the same calculation Faith uses. What remains are
     * `8:00 AM`, `10:00 AM` and `5:30 PM` on the School drop-off, Work focus and Family dinner rows.
     *
     * Those are placeholder *events* for Planner and Family, which own no data at all yet, and they
     * are not claims about a calculation the app can perform — the distinction that matters is whether
     * a literal contradicts something the app computes elsewhere. A prayer time did; a placeholder
     * dinner does not, because there is no other source of truth for it to disagree with.
     *
     * `the dashboard fixture states no prayer time` below is what keeps that distinction honest.
     */
    'src/mocks/main-home.ts',
  ];

  const CANDIDATES = ALL_FILES.map(relative).filter((file) => !DATE_ALLOWED.includes(file));

  it.each(CANDIDATES)('%s contains no clock time', (file) => {
    const source = stripComments(fs.readFileSync(path.join(REPO_ROOT, file), 'utf8'));
    // A quoted 12-hour clock time — "12:35 PM". Bare `HH:MM` is excluded because it also matches
    // legitimate things like a verse key, so the AM/PM suffix is what makes this specific.
    expect(source).not.toMatch(/['"`][^'"`]*\d{1,2}:\d{2}\s*(AM|PM)/i);
  });

  it.each(CANDIDATES)('%s contains no Gregorian or Hijri date', (file) => {
    const source = stripComments(fs.readFileSync(path.join(REPO_ROOT, file), 'utf8'));
    // "May 19, 2025"
    expect(source).not.toMatch(
      /(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s*\d{4}/,
    );
    // "21 Dhul-Qa'dah 1446 AH" — a formatted Hijri date rather than the month names alone.
    expect(source).not.toMatch(/\d{1,2}\s+\w[\w'’-]*\s+\d{3,4}\s*AH/);
  });

  it.each(CANDIDATES)('%s counts down to nothing', (file) => {
    const source = stripComments(fs.readFileSync(path.join(REPO_ROOT, file), 'utf8'));
    // "In 296 days" — a countdown with the number baked in rather than measured.
    expect(source).not.toMatch(/['"`]\s*In\s+\d+\s+days/i);
  });

  /**
   * The module-overview fixture's Faith entry states nothing about the user's worship.
   *
   * Targeted rather than pattern-based, because the file is exempt from the clock-time rule above for
   * the other seven modules and a blanket check would either miss Faith or fail on Planner. This reads
   * the Faith slice specifically.
   *
   * It asserts absence of the three things that were there: a prayer time, a completion state, and a
   * claim about a week. `metrics` and `activity` being empty is the current implementation; the
   * assertion is on the content rather than the shape, so populating them later with real repository
   * data would not fail this — putting literals back would.
   */
  /**
   * The dashboard fixture states no prayer time and names no prayer.
   *
   * Targeted, for the same reason as the module-overview case: the file is exempt from the clock-time
   * rule above so that Planner's and Family's placeholder events can stay, and a blanket check would
   * either fail on those or miss the row that mattered.
   *
   * The specific defect: Main Home rendered `12:35 PM · Dhuhr Prayer` — the deleted prayer-times
   * fixture's value — to every user, while the Faith module a tap away calculated 1:14 PM for the same
   * coordinate. Naming any of the five prayers here is enough to fail, because there is no honest
   * reason for this fixture to know one.
   */
  it('the dashboard fixture states no prayer time', () => {
    const source = stripComments(
      fs.readFileSync(path.join(REPO_ROOT, 'src/mocks/main-home.ts'), 'utf8'),
    );
    expect(source).not.toMatch(/(Fajr|Dhuhr|Asr|Maghrib|Isha)/i);
    expect(source).not.toMatch(/12:35/);
  });

  it('the module overview states nothing about the user’s worship', () => {
    const file = 'src/features/modules/services/mock-module-repository.ts';
    const source = stripComments(fs.readFileSync(path.join(REPO_ROOT, file), 'utf8'));

    // The Faith slice, from its key to the start of the next module's.
    const faith = /faith:\s*\{[\s\S]*?\n {2}\},/.exec(source)?.[0] ?? '';
    expect(faith).not.toBe('');

    // No clock time, in either 12-hour form.
    expect(faith).not.toMatch(/\d{1,2}:\d{2}\s*(am|pm)/i);
    // No prayer named beside a completion state.
    expect(faith).not.toMatch(/(Fajr|Dhuhr|Asr|Maghrib|Isha)/i);
    expect(faith).not.toMatch(/status:\s*'(done|due|missed)'/);
    // No claim about a period of the user's practice.
    expect(faith).not.toMatch(/(this week|last week|every day|streak)/i);
  });
});

describe('no Faith source presents generated text as a narration', () => {
  it.each(ALL_FILES.map(relative))('%s attributes nothing to a hadith collection', (file) => {
    const source = stripComments(fs.readFileSync(path.join(REPO_ROOT, file), 'utf8'));
    /*
      The Faith home's AI card read "Source: Sahih Bukhari" beneath a sentence the app had written.
      The Faith AI boundary rules forbid presenting generated text as Qur'an, Hadith or a ruling, and
      this was the clearest violation of them in the app — on the module's front page.

      The collections are named because a `Source:` prefix alone is too broad: the hadith repository
      legitimately attributes its own fixtures.
    */
    expect(source).not.toMatch(/Source:\s*(Sahih|Sunan|Jami|Musnad|Muwatta)/i);
  });

  /**
   * A citation is a provenance claim, with or without a `Source:` prefix.
   *
   * ── Why the rule above was not enough ───────────────────────────────────────
   * It matched `Source: Sahih …` and nothing else, so `reference: 'Sahih al-Bukhari 6464'` in the
   * Faith AI fixture passed it — and would have gone on passing, because that file also held an
   * exemption from the Arabic rule. Two narrow checks and one allow-list between them let a graded
   * narration sit in the app for several phases.
   *
   * This matches the citation itself: a collection name followed by a number, in any string, anywhere
   * in the scanned tree. There is no allow-list, because there is no longer any file in the tree that
   * legitimately cites a collection — the Hadith provider is unapproved and its screen is a locked
   * state. When a provider is approved, its citations will arrive in a response at runtime rather than
   * as literals in the bundle, so this rule stays correct rather than needing an exception.
   */
  it.each(ALL_FILES.map(relative))('%s cites no hadith collection and number', (file) => {
    const source = stripComments(fs.readFileSync(path.join(REPO_ROOT, file), 'utf8'));
    expect(source).not.toMatch(
      /(Sahih|Sunan|Jami|Musnad|Muwatta|Bukhari|Muslim|Tirmidhi|Nasa'?i|Abu\s+Dawud|Ibn\s+Majah)[^'"`\n]{0,40}\d+/i,
    );
  });

  /**
   * No source names a surah and ayah as a scripture reference literal.
   *
   * The Faith AI fixture carried `reference: 'Surah Ash-Sharh 94:6'`, and `faith-view-model.ts` before
   * it carried the same verse's Arabic. A `chapter:verse` pair on its own is not matched — the
   * catalogue, the rotation and the reader all address ayat by number legitimately, and forbidding
   * that would forbid the feature. What is matched is the *prose* form, which only appears when
   * something is presenting a citation to a reader.
   */
  it.each(ALL_FILES.map(relative))('%s names no surah as a scripture citation', (file) => {
    const source = stripComments(fs.readFileSync(path.join(REPO_ROOT, file), 'utf8'));
    expect(source).not.toMatch(/(Surah|Sūrah|Sura)\s+[A-Z][\w'’-]+\s+\d{1,3}:\d{1,3}/);
  });

  /**
   * No source states a scholarly position or a ruling as settled.
   *
   * The removed replies said "Here is what the commonly-cited sources address on this subject" and
   * "This ayah is widely read as a reassurance that…" — exegetical and scholarly claims generated by
   * a keyword classifier. The `qualified` reply kind exists precisely so the app can decline these,
   * and the phrasing below is what declining looks like being quietly reintroduced.
   */
  it.each(ALL_FILES.map(relative))('%s states no scholarly position as settled', (file) => {
    const source = stripComments(fs.readFileSync(path.join(REPO_ROOT, file), 'utf8'));
    expect(source).not.toMatch(
      /(widely read as|scholars agree|it is agreed that|the sources say)/i,
    );
  });
});

describe('the prominent API-source banner is gone', () => {
  it('no Faith source renders the vendor’s API product as a badge', () => {
    for (const file of ALL_FILES) {
      const source = stripComments(fs.readFileSync(file, 'utf8'));
      /*
        `Source: ${...}` interpolating a content source's name, which is how the badge read
        "Source: Quran Foundation Content API" above the scripture on three reading surfaces.
        `UnverifiedSourceNotice` now returns null for a verified source and has no such template;
        attribution moved to the reader's translation credit and to the content-information screen.
      */
      expect(source).not.toMatch(/`Source:\s*\$\{/);
    }
  });

  it('keeps the acknowledgment somewhere a reader can find it', () => {
    const contentInfo = fs.readFileSync(
      path.join(REPO_ROOT, 'src/features/faith/screens/content-info-screen.tsx'),
      'utf8',
    );
    // Removing the banner must not remove the attribution — this is the other half of that change.
    expect(contentInfo).toMatch(/Quran Foundation Content API/);
  });
});
