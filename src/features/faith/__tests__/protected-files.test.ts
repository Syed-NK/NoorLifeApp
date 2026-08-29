import fs from 'node:fs';
import path from 'node:path';

import {
  readBaselineFile,
  resolveProtectedBaseline,
  type ResolvedBaseline,
} from '../../../test-support/protected-baseline';

/**
 * Design-locked files must be unchanged from the branch point.
 *
 * ── Why this compares against git rather than a stored hash ─────────────────
 * A checked-in hash list is a second thing to keep in step, and the failure mode is
 * someone updating the hash instead of reverting the file — which is precisely the change
 * this test exists to catch. Diffing against the branch point asks git the real question:
 * "did this branch touch a locked file?"
 *
 * The list is Main Home and Entry/Auth, which the briefs name as untouchable. Shared
 * module-framework files are *not* listed: this work legitimately changes the module
 * scaffold, header and navigation, and locking the whole framework would make that
 * impossible to do honestly.
 */

/**
 * The source with its comments removed.
 *
 * Block comments go wholesale; a line comment is dropped only when it *begins* a line, so a double
 * slash inside a string is never mistaken for the start of one.
 */
function codeOf(source: string): string {
  const OPEN = String.fromCharCode(47, 42);
  const CLOSE = String.fromCharCode(42, 47);
  const LINE = String.fromCharCode(47, 47);
  let out = source;
  for (;;) {
    const start = out.indexOf(OPEN);
    if (start === -1) break;
    const end = out.indexOf(CLOSE, start + OPEN.length);
    if (end === -1) break;
    out = out.slice(0, start) + out.slice(end + CLOSE.length);
  }
  const newline = String.fromCharCode(10);
  return out
    .split(newline)
    .filter((line) => !line.trim().startsWith(LINE))
    .join(newline);
}

const PROTECTED_PATHS: readonly string[] = [
  // Main Home — design-locked.
  'src/features/home/components/robot-asset.tsx',
  'src/features/home/main-home-metrics.ts',
  'src/features/home/module-pictograms.ts',
  'src/features/home/module-tile-theme.ts',
  // Entry / Auth — approved layouts.
  'src/features/entry-auth/entry-auth-tokens.ts',
  'src/features/entry-auth/entry-auth-copy.ts',
  'src/features/entry-auth/entry-auth-assets.ts',
  'src/features/entry-auth/screens/splash-screen.tsx',
];

/**
 * Entry screens deliberately reopened, with the reason recorded rather than the entry deleted.
 *
 * The entry sequence was asked to carry a shared step indicator and swipe-back navigation across
 * onboarding, Welcome and the credentials screens, so the user can return to an earlier screen.
 * That cannot be built without editing these four files, so their byte-for-byte lock was lifted on
 * request. Leaving them silently absent from the list above is the failure mode this whole test is
 * designed to catch, so they are named here instead.
 *
 * What remains locked is the part that carries the approved design: `entry-auth-tokens.ts`,
 * `entry-auth-copy.ts`, `entry-auth-assets.ts` and the splash composition are all still above, and
 * this work changed none of them — no colour, measurement, string or asset moved. The changes are
 * structural: a footer slot, a dot row and a gesture wrapper.
 *
 * Anything beyond that still needs the design owner's sign-off.
 */
const REOPENED_ON_REQUEST: readonly string[] = [
  'src/features/entry-auth/screens/onboarding-screen.tsx',
  'src/features/entry-auth/screens/welcome-screen.tsx',
  'src/features/entry-auth/screens/login-screen.tsx',
  'src/features/entry-auth/screens/sign-up-screen.tsx',
  /**
   * Main Home's module grid — reopened for Phase 6B.
   *
   * Free users must see the six paid modules as locked, and there is no way to render a lock state
   * on a tile without editing the file that draws the tile. The phase brief authorises exactly
   * this: entitlement-aware states *within* the existing geometry.
   *
   * What did not change is the geometry itself. Every locked measurement still comes from
   * `LOCKED.grid` — four columns, 7 dp gaps, 71 dp tiles, 13 dp radius, 48 dp pictograms — and
   * `main-home-metrics.ts` is untouched and still locked above. The approved PNGs are still
   * rendered by `getModulePictogram`, never swapped for a lock glyph. What was added is a scrim, a
   * badge and a branch on entitlement.
   *
   * The Pixel 8 pass then found two faults in that work, corrected under this same entry rather than
   * a new one:
   *
   *   • The scrim was the *last* child, so it washed over the label as well as the tile and took it
   *     from ~15:1 to 2.68:1. It is now drawn first. Same tint, same alpha, same geometry.
   *   • A locked tap pushed the subscription chooser directly, skipping the contextual explanation
   *     every other locked Main Home surface raises. It now calls the shared `requestUpgrade`
   *     controller, and the badge grew to a recognisable 12 dp glyph.
   *
   * A geometry test in the Main Home suite asserts the tile count and layout are unchanged, and
   * `main-home-lock-contrast.test.ts` measures the locked label and padlock against the colour the
   * tile actually composites to. Those are the guarantees this entry gives up and those tests take
   * over.
   */
  'src/features/home/components/module-grid.tsx',
  /**
   * "Today at a Glance" and the two summary cards — reopened for Phase 6B.
   *
   * Reason recorded on request: **user-approved Free entitlement presentation and interaction.**
   *
   * Three of the four timeline rows and both summary figures are paid content. A free user
   * currently sees School drop-off, Work focus time and Family dinner as ordinary rows that walk
   * into Planner and Family, and is shown "4 of 5 complete" and "68% — You're on track", which are
   * statements about a week they do not have. Neither can be corrected without editing the file
   * that draws the row and the file that draws the card, so their byte-for-byte lock was lifted on
   * request rather than the entries being quietly deleted.
   *
   * What did not change is the geometry. Every measurement still comes from `LOCKED.today` and
   * `LOCKED.summary` — the 126 dp card, the 23 dp rows, the 7 dp dot, the 62 dp time column, the
   * 90 dp summary cards, the 46 dp ring and its 6 dp stroke — and `main-home-metrics.ts` is
   * untouched and still locked above. Section order, card positions, spacing and the type ramp are
   * as they were; the locked states are drawn *inside* that geometry. The Main Home suite asserts
   * those dimensions directly, which is the guarantee these two entries give up and that test
   * takes over.
   *
   * Anything beyond entitlement state in these two files still needs the design owner's sign-off.
   */
  'src/features/home/components/today-timeline.tsx',
  'src/features/home/components/home-summary-row.tsx',
  /**
   * The Main Home screen itself — reopened for Phase 6B on an approved architecture decision.
   *
   * Reason recorded on request: **user-approved Free entitlement presentation and interaction.**
   *
   * Five surfaces on this screen raise contextual upgrade explanations, or will: the timeline
   * rows, the two summary cards, the Noor AI insight, the quick actions and the bottom
   * navigation. Their nearest common ancestor is this file, so it is the narrowest level at which
   * one controller can serve all five and one sheet can be drawn. The alternatives were both
   * rejected on the record: `AppProviders` would hold Main Home's state for every route in the
   * app, and anything lower would give each row and card a modal of its own.
   *
   * The permitted change is exactly that and nothing else — one `UpgradeSheetProvider` and one
   * `UpgradeSheetHost` in the screen's shell function. Both are layout-neutral: the provider
   * renders context alone, and the host renders nothing until something asks for it and a `Modal`
   * after that, which takes no part in the flex layout of the column. `MainHomeContent`, which
   * holds the entire visual composition, is untouched — no padding, no wrapper view, no visible
   * element, no reordered section, and `main-home-metrics.ts` is untouched and still locked above.
   *
   * A section-order test in the Main Home suite asserts all seven sections still render in the
   * locked sequence, which is the guarantee this entry gives up and that test takes over.
   */
  'src/features/home/screens/main-home-screen.tsx',
  /**
   * The Noor AI insight card, the quick-action row and the bottom navigation — reopened for
   * Phase 6B.
   *
   * Reason recorded on request: **user-approved Free entitlement presentation and interaction.**
   *
   * These are the three remaining Main Home surfaces that offer a free user something the free plan
   * does not include, and each is wrong in a different way:
   *
   *   • The insight card states "You have a free 30-minute window at 4 PM", which is a claim about a
   *     Planner schedule the user does not have. Noor AI itself is *not* locked — it is on the free
   *     plan — so the correction is a scope, not a padlock: the card says what Noor AI can actually
   *     help with and announces the narrower scope it works in.
   *   • All three quick actions belong to premium modules (Planner, Health, Family), and each one
   *     currently walks straight into that module to start an edit.
   *   • The Insights tab opens a Goals-powered screen the free plan does not include.
   *
   * None of that can be corrected without editing the file that draws the card, the file that draws
   * the tiles and the file that draws the bar, so their byte-for-byte lock was lifted on request
   * rather than the entries being quietly deleted.
   *
   * What did not change is the geometry. Every measurement still comes from `LOCKED.aiInsight`,
   * `LOCKED.quickAction` and `LOCKED.bottomNav` — the 68 dp card and its 44 dp robot and chevron, the
   * 42 dp tiles at 11 dp radius with their 7 dp gap, the 68 dp bar with five `flex: 1` slots, 24 dp
   * icons and the 58 dp centre ring holding the 50 dp robot PNG — and `main-home-metrics.ts` is
   * untouched and still locked above. The approved PNG assets are still rendered by `RobotAsset`,
   * never swapped for a lock glyph, and the centre control carries no badge at all. Both padlocks
   * added here are absolutely positioned, so neither takes part in the layout: the quick-action label
   * keeps the width it has on a paid plan, and the bar keeps its height.
   *
   * A geometry suite in `main-home-premium-actions.test.tsx` measures all three surfaces in both the
   * free and the paid state, against the same numbers. That is the guarantee this entry gives up and
   * that test takes over.
   *
   * Anything beyond entitlement state in these three files still needs the design owner's sign-off.
   */
  'src/features/home/components/ai-insight-card.tsx',
  /**
   * The Main Home header and hero — reopened for the app-wide 44 dp accessibility floor.
   *
   * Reason recorded on request: **the product decision that the app-wide 44 dp accessibility
   * minimum overrides older visual-geometry locks**, with visual appearance preserved wherever a
   * larger accessibility node can be provided without overlap, and accessible geometry taking
   * precedence where it cannot.
   *
   * What was wrong. Both files fix a container height from `LOCKED` and scale it with `dp()`. The
   * controls inside are `PressableScale`s that now carry the shared floor, but a parent with a
   * fixed height clips them, so on a 320 dp handset the profile row, the notification button and
   * the hero call to action measured **41.481, 41.481 and 41.778 dp** against a 44 dp contract.
   * At 393 dp they were already compliant, which is why this only appears at narrow widths.
   *
   * What changed. Those two container heights became **minimums**. Nothing else moved: the same
   * `LOCKED` values, the same paddings, the same order, the same colours, and
   * `main-home-metrics.ts` is untouched and still locked above. On every width where the content
   * already fits — which includes the 393 dp reference the design was drawn at — the rendered
   * height is identical. It grows only where a control would otherwise be clipped below the
   * minimum.
   *
   * The guarantee this entry gives up is byte-for-byte immutability. What takes over is
   * `touch-target-floor.test.tsx`, which asserts the floor on the actual accessibility node at
   * both font scales and at 393, 360 and 320 dp, and the Main Home geometry suites, which now
   * assert the locked value as a minimum rather than as a fixed height.
   */
  'src/features/home/components/home-header.tsx',
  'src/features/home/components/home-hero.tsx',
  'src/features/home/components/quick-actions-row.tsx',
  'src/features/home/components/home-bottom-navigation.tsx',
  /**
   * The authentication service — reopened for Phase 6C-3C, for callback wiring only.
   *
   * Reason recorded on request: **the phase brief instructs that `signUp`, `resetPasswordForEmail` and
   * the email-change flow supply the approved callback redirect from central configuration.**
   *
   * The lock could not be honoured and that instruction followed at the same time. This file owned the
   * redirect for two of the three email actions:
   *
   *     cachedRedirect = AuthSession.makeRedirectUri({ scheme: 'noorlifeapp' });
   *
   * which resolves to the bare scheme root `noorlifeapp://` — a URL nothing in the application was
   * listening on. There was no deep-link handler and no callback route, so a real confirmation or
   * recovery link landed on the entry gate with its code discarded. Leaving the value alone and
   * building the new callback around it would have meant either accepting the scheme root as a trusted
   * callback path — widening the trust boundary to a URL that carries no destination — or duplicating
   * `signUp` in a second service that could drift from this one. Both are worse than a recorded lift.
   *
   * The permitted change is exactly one function body. `redirectTo()` now returns
   * `authCallbackRedirectUrl()` from `auth-callback.config.ts`, and the now-unused `expo-auth-session`
   * import went with it. Laziness is preserved, so importing this service still needs no
   * expo-constants manifest — the property the original memoization existed to protect.
   *
   * Nothing else moved: no exported function was added, removed or renamed, no error mapping changed,
   * no logging was added, and the file still contains no credential handling it did not already have.
   * `auth-service-surface.test.ts` asserts the exported API is identical to the branch point and that
   * the redirect comes from the central configuration rather than a literal. That is the guarantee this
   * entry gives up and that test takes over.
   *
   * Anything beyond callback wiring in this file still needs sign-off.
   */
  'src/services/auth/auth.service.ts',
];

/**
 * Line endings are normalised before comparing.
 *
 * `core.autocrlf` is true on Windows, so git stores LF and checks out CRLF. `git show`
 * returns the stored blob while the filesystem returns the working copy, and the two
 * differ on every line by an invisible byte nobody typed. Comparing raw would make this
 * test fail after a `git checkout` — a *restore*, which is the opposite of the edit it
 * exists to catch.
 *
 * Everything else stays byte-exact: a changed space, a reordered import or a reworded
 * comment all still fail.
 */
function normalise(value: string): string {
  return value.replace(/\r\n/g, '\n');
}

/**
 * The baseline, resolved once and lazily.
 *
 * Deliberately not inside a `try`. `resolveProtectedBaseline` throws when none of the local branch,
 * the remote-tracking branch or the pinned commit resolves, and that exception is allowed to reach
 * Jest from whichever test asked for it. Every assertion below therefore fails when the baseline is
 * unreachable — none of them can quietly pass, and none of them is skipped.
 */
let resolved: ResolvedBaseline | null = null;
function baseline(): ResolvedBaseline {
  resolved ??= resolveProtectedBaseline();
  return resolved;
}

describe('protected design-locked files', () => {
  it('can resolve the base ref to compare against', () => {
    // If this fails the suite below is meaningless, so it is asserted rather than
    // silently skipped — a protection test that quietly does nothing is worse than none.
    const { ref, source } = baseline();
    expect(ref).toBeTruthy();
    expect(['local-branch', 'remote-branch', 'immutable-sha']).toContain(source);
  });

  it.each(PROTECTED_PATHS)('%s is unchanged from the branch point', (filePath) => {
    const { ref } = baseline();

    const baselineContent = readBaselineFile(ref, filePath);
    expect(baselineContent).not.toBeNull();

    const current = fs.readFileSync(path.join(process.cwd(), filePath), 'utf8');
    expect(normalise(current)).toBe(normalise(baselineContent as string));
  });
});

/**
 * The reopened entry screens keep the *visual* lock even though the byte lock is gone.
 *
 * A file removed from the list above would otherwise be free to drift in any direction. These two
 * checks keep the part that matters: the approved palette and measurements stay in the locked token
 * file, so a colour or size cannot be quietly introduced at the call site.
 */
describe('entry screens reopened on request', () => {
  it('does not also claim to lock them, which would contradict itself', () => {
    for (const filePath of REOPENED_ON_REQUEST) {
      expect(PROTECTED_PATHS).not.toContain(filePath);
    }
  });

  it.each(
    REOPENED_ON_REQUEST.filter(
      (f) => !f.endsWith('home-header.tsx') && !f.endsWith('home-hero.tsx'),
    ),
  )('%s hard-codes no colour of its own', (filePath) => {
    /*
      Comments stripped first. A reopened file records *why* it was reopened, and an issue
      reference like the one above is three hex digits to a naive scan — so the rule read its own
      justification as a colour literal. Stripping prose keeps the rule pointed at code, and cannot
      hide a real colour: a comment paints nothing.
    */
    const current = codeOf(fs.readFileSync(path.join(process.cwd(), filePath), 'utf8'));

    // Every colour on these screens must come from entryAuthColors. A literal here would be a
    // visual change escaping the lock on entry-auth-tokens.ts.
    expect(current).not.toMatch(/#[0-9A-Fa-f]{3,8}\b/);
    expect(current).not.toMatch(/\brgba?\(/);
  });

  /**
   * The two files reopened for accessibility carry colours that predate this rule.
   *
   * They were byte-for-byte locked rather than token-audited, so `AVATAR_BORDER`, `STAR_COLOR`
   * and `BUTTON_TEXT_COLOR` are literals. Migrating them to tokens is a visual change and is not
   * what the accessibility decision authorised, so the rule they are held to is the one that
   * actually matters here: **this work changed no colour**. Every literal must still be exactly
   * the set the branch point had.
   */
  const ACCESSIBILITY_REOPENED = [
    'src/features/home/components/home-header.tsx',
    'src/features/home/components/home-hero.tsx',
  ];

  it.each(ACCESSIBILITY_REOPENED)('%s changes no colour it already had', (filePath) => {
    const ref = baseline().ref;
    const before = readBaselineFile(ref, filePath);
    expect(before).not.toBeNull();
    const literals = (source: string) => (source.match(/#[0-9A-Fa-f]{3,8}/g) ?? []).sort();
    const current = fs.readFileSync(path.join(process.cwd(), filePath), 'utf8');
    expect(literals(current)).toEqual(literals(before as string));
  });
});
