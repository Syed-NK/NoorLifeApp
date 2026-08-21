import { render } from '@testing-library/react-native';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  STARTUP_RESOLVING_MESSAGE,
  StartupResolvingNotice,
} from '../components/startup-resolving-notice';

/**
 * **What a slow launch is allowed to say** — the presentation half of issue #31.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * The startup machine no longer converts an unanswered launch into a signed-out one, so something has
 * to be on screen while the wait continues. The risk in adding anything there is saying too much: at
 * that moment the app does not know who the user is — that is *why* it is rendering — so any
 * reassurance about identity would be the same class of untruth as the redirect it replaces.
 *
 * These tests are mostly about absence, which is why several of them read the source: a rendered
 * assertion can show that a name is not displayed today, but not that the component has no way to
 * reach one.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const SOURCE = readFileSync(
  join(__dirname, '..', 'components', 'startup-resolving-notice.tsx'),
  'utf8',
);

/** Comment-stripped, so prose about identity cannot fail an assertion about reading it. */
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('it says something true and nothing more', () => {
  it('states that work is still happening, in the present tense', async () => {
    const view = await render(<StartupResolvingNotice />);

    expect(view.getByText(STARTUP_RESOLVING_MESSAGE)).toBeTruthy();
    /*
      Not an error, because nothing has failed at ten seconds. Copy that apologised would be as
      inaccurate as the redirect, in the other direction.
    */
    expect(STARTUP_RESOLVING_MESSAGE).not.toMatch(/wrong|error|fail|sorry|problem|unable/i);
  });

  it('claims nothing about who is signed in', () => {
    expect(STARTUP_RESOLVING_MESSAGE).not.toMatch(
      /welcome back|signing you in|your account|assalamu|hello|hi\b/i,
    );
  });
});

describe('it cannot reach account data', () => {
  it('reads no session, profile or identity', () => {
    /*
      Structural, not cosmetic. A component that imported `useAuth` or `useCurrentUser` could render a
      name the moment somebody added a line — and this renders precisely when the app has no confirmed
      answer about identity, so there would be nothing honest to render.
    */
    expect(CODE).not.toMatch(/useAuth|useCurrentUser|useAuthCallback|AuthState/);
    expect(CODE).not.toMatch(/user|profile|email|avatar|greeting|fullName|givenName/i);
  });

  it('mounts no provider and issues no read', () => {
    expect(CODE).not.toMatch(/Provider|AsyncStorage|SecureStore|fetch\(|repository/i);
    expect(CODE).not.toMatch(/useEffect|useState/);
  });

  it('offers no action, so it cannot become a retry', () => {
    /*
      A "Try again" here would re-run a resolution already in flight — a retry wearing a button, which
      the issue's constraints rule out. There is nothing useful for the user to do while a read
      completes, and a control that implies otherwise is worse than none.
    */
    expect(CODE).not.toMatch(/Pressable|TouchableOpacity|Button|onPress/);
  });
});

describe('it is announced once, and politely', () => {
  it('carries the message as a single live region', async () => {
    const view = await render(<StartupResolvingNotice />);
    const region = view.getByTestId('startup-resolving-notice');

    expect(region.props.accessibilityLabel).toBe(STARTUP_RESOLVING_MESSAGE);
    expect(region.props.accessibilityLiveRegion).toBe('polite');
    expect(region.props.accessibilityRole).toBe('progressbar');
  });

  it('hides the spinner from the reader, so the state is announced once', () => {
    /*
      An unlabelled busy indicator plus a separate line reads as two things happening. The label on the
      region carries the whole message and the indicator is excluded.
    */
    expect(CODE).toContain('accessibilityElementsHidden');
    expect(CODE).toContain('importantForAccessibility="no"');
  });

  it('is polite rather than assertive', () => {
    // A progress update does not deserve to interrupt whatever a screen reader is currently saying.
    expect(CODE).not.toContain('"assertive"');
  });
});

describe('it uses the approved launch palette and touches no locked file', () => {
  it('takes its colour and type from entry-auth tokens', () => {
    expect(CODE).toContain('entryAuthColors');
    expect(CODE).toContain('EntryAuthText');
    // No literal colours: the launch palette has one source.
    expect(CODE).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it('does not import or wrap the design-locked splash', () => {
    /*
      `splash-screen.tsx` is byte-locked and takes no props. This is additive — the entry gate renders
      it unchanged and places this underneath — so the ordinary launch is pixel-identical to before and
      only a launch past the ceiling looks different.
    */
    expect(CODE).not.toContain('SplashScreen');
    expect(CODE).not.toContain('splash-screen');
  });
});

describe('the entry gate shows it only while genuinely unresolved', () => {
  const GATE = readFileSync(join(__dirname, '..', '..', '..', 'app', 'index.tsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

  it('renders it on the still_resolving state and no other', () => {
    expect(GATE).toContain("state === 'still_resolving' ? <StartupResolvingNotice /> : null");
  });

  it('renders it inside the branch that has no destination', () => {
    /*
      Which is the guarantee that matters: the notice appears only where the gate was already showing
      the splash and waiting. It is not an alternative to a destination — it is what waiting looks
      like once waiting has gone on a while.
    */
    const waiting = GATE.slice(
      GATE.indexOf('if (destination === null)'),
      GATE.indexOf('return <Redirect href={hrefFor(destination)} />'),
    );
    expect(waiting).toContain('StartupResolvingNotice');
    expect(waiting).toContain('<SplashScreen />');
  });

  it('navigates nowhere while resolving, so Back has nothing to fall back through', () => {
    /*
      The old behaviour issued a `Redirect` to the authentication route at ten seconds, which put a
      real navigation in the history for a launch that had concluded nothing. Now nothing is pushed or
      replaced until a destination exists, so there is no Back path to expose and none to escape.
    */
    const waiting = GATE.slice(
      GATE.indexOf('if (destination === null)'),
      GATE.indexOf('return <Redirect href={hrefFor(destination)} />'),
    );
    expect(waiting).not.toContain('Redirect');
  });
});
