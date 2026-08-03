import fs from 'node:fs';
import path from 'node:path';

import { act, render } from '@testing-library/react-native';
import * as ExpoSplashScreen from 'expo-splash-screen';
import { View } from 'react-native';

import {
  NATIVE_SPLASH_BACKSTOP_MS,
  NATIVE_SPLASH_FALLBACK_MS,
  resetNativeSplashHandoff,
  useNativeSplashBackstop,
  useNativeSplashHandoff,
} from '../use-native-splash-handoff';

/**
 * The native splash must dismiss without any user interaction.
 *
 * ── The regression ──────────────────────────────────────────────────────────
 * `hideAsync` used to have exactly one trigger — `onLayout` on a view that only mounted once the
 * session had resolved — so a stalled network left the native splash up until the user touched the
 * screen. These lock down the two properties that prevent it recurring: more than one automatic
 * path to dismissal, and no dependency on anything slow.
 */

function Harness({ layout = true }: { readonly layout?: boolean }) {
  const { onBrandedSplashLayout } = useNativeSplashHandoff();
  return <View testID="splash" onLayout={layout ? onBrandedSplashLayout : undefined} />;
}

/**
 * Settles the handoff's two-stage async work.
 *
 * Order matters: the asset promise must resolve and commit its state before timers advance, because
 * the `requestAnimationFrame` on the normal path is only scheduled by the effect that runs *after*
 * that commit. Advancing timers first would run the frame queue while it was still empty.
 */
async function settle(rounds = 3): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      jest.advanceTimersByTime(50);
    });
  }
}

/** Fires the `onLayout` the branded splash wrapper would fire, with a plausible event. */
function fireLayout(node: { readonly props: Record<string, unknown> }) {
  const onLayout = node.props.onLayout as ((event: unknown) => void) | undefined;
  onLayout?.({ nativeEvent: { layout: { x: 0, y: 0, width: 393, height: 852 } } });
}

describe('the native splash dismisses automatically', () => {
  let hideAsync: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    hideAsync = jest.spyOn(ExpoSplashScreen, 'hideAsync').mockResolvedValue(undefined);
    /**
     * The "has it been asked to hide?" guard is process-wide, not per instance.
     *
     * It moved there in 6C-3C so the entry gate and the root layout's route backstop cannot both call
     * `hideAsync` — the native splash is one global native resource. Each test here is a fresh launch,
     * so the flag is cleared between them; without this, only the first mount in the file would hide.
     */
    resetNativeSplashHandoff();
  });

  afterEach(() => {
    jest.useRealTimers();
    hideAsync.mockRestore();
  });

  it('hides once both signals arrive, with no interaction', async () => {
    const view = await render(<Harness />);
    fireLayout(view.getByTestId('splash'));

    await settle();

    expect(hideAsync).toHaveBeenCalled();
  });

  it('hides via the fallback even when the layout signal never arrives', async () => {
    // Simulates the failure mode directly: the view never reports layout.
    await render(<Harness layout={false} />);

    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      jest.advanceTimersByTime(NATIVE_SPLASH_FALLBACK_MS + 50);
    });

    // The whole point: a missing signal degrades to a late dismissal, never a frozen screen.
    expect(hideAsync).toHaveBeenCalled();
  });

  it('has a bounded fallback ceiling', () => {
    expect(NATIVE_SPLASH_FALLBACK_MS).toBe(1500);
  });

  it('does not hide before the fallback when signals are missing', async () => {
    await render(<Harness layout={false} />);

    await act(async () => {
      await Promise.resolve();
      jest.advanceTimersByTime(NATIVE_SPLASH_FALLBACK_MS - 200);
    });

    // Still waiting for the normal path; the ceiling has not been reached.
    expect(hideAsync).not.toHaveBeenCalled();
  });

  it('calls hideAsync exactly once even when both paths race', async () => {
    const view = await render(<Harness />);
    fireLayout(view.getByTestId('splash'));

    await settle();
    await act(async () => {
      // Well past the fallback, so both paths have had their chance.
      jest.advanceTimersByTime(NATIVE_SPLASH_FALLBACK_MS * 3);
    });

    expect(hideAsync).toHaveBeenCalledTimes(1);
  });

  it('marks itself hidden even when hideAsync rejects', async () => {
    hideAsync.mockRejectedValue(new Error('already hidden'));
    const view = await render(<Harness />);
    fireLayout(view.getByTestId('splash'));

    await settle();

    // A rejected hide must not trigger a retry loop against a splash that is already gone.
    expect(hideAsync).toHaveBeenCalledTimes(1);
  });
});

/**
 * A cold-start deep link, which is the launch the entry gate never sees.
 *
 * ── The regression these lock down ──────────────────────────────────────────
 * Expo Router makes a deep-linked route the *initial* route, so `src/app/index.tsx` — the only caller
 * of `useNativeSplashHandoff` — never mounts. Neither of its two paths was armed, not even the 1500 ms
 * ceiling, and the **native** splash stayed up over a working screen indefinitely. Measured on the
 * emulator in Phase 6C-3C: `noorlifeapp://auth/callback` from a force-stopped app never painted the
 * app at all, and it was indistinguishable from a hang.
 *
 * The route backstop is what fixes it. It is mounted by the root layout, which mounts for every route.
 */
describe('the route backstop covers a launch that never mounts the entry gate', () => {
  let hideAsync: jest.SpyInstance;

  function Root({ withGate }: { readonly withGate: boolean }) {
    useNativeSplashBackstop();
    return withGate ? <Harness /> : <View testID="deep-linked-route" />;
  }

  beforeEach(() => {
    jest.useFakeTimers();
    hideAsync = jest.spyOn(ExpoSplashScreen, 'hideAsync').mockResolvedValue(undefined);
    resetNativeSplashHandoff();
  });

  afterEach(() => {
    jest.useRealTimers();
    hideAsync.mockRestore();
  });

  it('hides the native layer when the gate is absent', async () => {
    await render(<Root withGate={false} />);

    await act(async () => {
      jest.advanceTimersByTime(NATIVE_SPLASH_BACKSTOP_MS + 100);
    });

    expect(hideAsync).toHaveBeenCalledTimes(1);
  });

  it('does not pre-empt the seamless handoff on an ordinary launch', async () => {
    const view = await render(<Root withGate />);
    fireLayout(view.getByTestId('splash'));

    await settle();

    // The gate's normal path has already won, well before the backstop's ceiling.
    expect(hideAsync).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(NATIVE_SPLASH_BACKSTOP_MS * 2);
    });

    // And the backstop does not ask again: the guard is process-wide, not per instance.
    expect(hideAsync).toHaveBeenCalledTimes(1);
  });

  it('waits longer than the gate’s own fallback, so it is a backstop and not a competitor', () => {
    // Hiding the native layer before the branded splash has painted would put a blank frame in the
    // handoff — the thing the two-signal design exists to avoid.
    expect(NATIVE_SPLASH_BACKSTOP_MS).toBeGreaterThan(NATIVE_SPLASH_FALLBACK_MS);
  });

  it('takes no signal, so nothing slow can block it', () => {
    const source = codeOnly(
      path.join(process.cwd(), 'src', 'application', 'startup', 'use-native-splash-handoff.ts'),
    );
    const backstop = source.slice(source.indexOf('export function useNativeSplashBackstop'));
    expect(backstop).not.toMatch(/artworkLoaded|mounted|useAuth|onLayout/);
  });
});

describe('the root layout arms the backstop', () => {
  it('calls it, so every launch has a ceiling however it started', () => {
    const root = fs.readFileSync(path.join(process.cwd(), 'src', 'app', '_layout.tsx'), 'utf8');
    // Asserted at the call site rather than only in the hook: a hook nobody calls is a hook that does
    // nothing, and that is exactly the shape the original bug had.
    expect(root).toMatch(/useNativeSplashBackstop\(\)/);
  });
});

/**
 * Strips comments so a scan sees code rather than prose.
 *
 * Necessary here: the hook documents the very bug it prevents, so its comments legitimately mention
 * the session, onboarding and the 1800 ms minimum. Matching raw text would fail on the explanation
 * instead of on a real dependency.
 */
function codeOnly(file: string): string {
  return fs
    .readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

describe('the handoff cannot be blocked by slow dependencies', () => {
  const source = codeOnly(
    path.join(process.cwd(), 'src', 'application', 'startup', 'use-native-splash-handoff.ts'),
  );

  it('does not consult the session', () => {
    // `ready` used to include `auth.status !== 'unknown'`, which resolves over the network. That
    // single coupling is what let a flaky connection freeze the launch screen.
    expect(source).not.toMatch(/useAuth|auth\.status|isSignedIn/);
  });

  it('does not consult onboarding or entitlement state', () => {
    expect(source).not.toMatch(/onboarding|entitlement|subscription/i);
  });

  it('does not consult font readiness', () => {
    // The branded splash is a full-screen PNG; it needs no live typography to be correct.
    expect(source).not.toMatch(/useFontReadiness|fonts\.ready/);
  });

  it('does not wait for the branded splash minimum', () => {
    expect(source).not.toMatch(/FIRST_LAUNCH_SPLASH_MS|1800/);
  });

  it('has no touch, press or gesture handler', () => {
    // The bug's signature was "it goes away when you swipe". Nothing here may respond to input.
    expect(source).not.toMatch(/onPress|onTouch|Pressable|PanResponder|Gesture|onResponder/);
  });
});

describe('the startup router no longer owns native dismissal', () => {
  const routing = codeOnly(
    path.join(process.cwd(), 'src', 'application', 'startup', 'use-startup-routing.ts'),
  );

  it('does not call hideAsync', () => {
    // Dismissal lives in the handoff hook precisely so it cannot be coupled to routing again.
    expect(routing).not.toMatch(/hideAsync/);
  });
});

describe('preventAutoHideAsync is initialised exactly once', () => {
  it('is called only from the root layout, at module scope', () => {
    const root = fs.readFileSync(path.join(process.cwd(), 'src', 'app', '_layout.tsx'), 'utf8');
    expect(root.match(/preventAutoHideAsync/g)).toHaveLength(1);

    // And nowhere else in the application.
    const walk = (dir: string): string[] => {
      const out: string[] = [];
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) {
          continue;
        }
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          out.push(...walk(full));
        } else if (/\.tsx?$/.test(entry.name) && !full.includes('__tests__')) {
          out.push(full);
        }
      }
      return out;
    };

    const callers = walk(path.join(process.cwd(), 'src')).filter((file) =>
      /preventAutoHideAsync/.test(fs.readFileSync(file, 'utf8')),
    );
    expect(callers).toHaveLength(1);
  });
});
