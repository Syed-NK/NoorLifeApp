import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { act, render, screen } from '@testing-library/react-native';
import { StrictMode } from 'react';
import { Text } from 'react-native';

import {
  StartupPresentationProvider,
  STARTUP_PRESENTATION_TICK_MS,
  useStartupPresentation,
} from '@application/startup/startup-presentation-provider';
import { STARTUP_PRESENTATION_CEILING_MS } from '@application/startup/startup-machine';
import { STARTUP_RESOLVING_MESSAGE } from '@features/entry-auth/components/startup-resolving-notice';

/**
 * **One launch, one clock, one owner** — issue #58.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * The clock used to live inside `useStartupRouting`, which `src/app/index.tsx` is the only file to
 * call. So a deep-linked launch — where Expo Router makes the target the initial route and the entry
 * gate never mounts — ran no clock at all, reached no ceiling, and had nothing to show for the wait.
 *
 * Moving ownership is the fix, and moving ownership is also the risk. The failure modes worth a test
 * are not about what the notice looks like; they are about there being exactly one of everything.
 * Two intervals would be two launches disagreeing about when this one began, and a timer that
 * outlived its tree would be an update after unmount on every navigation away from a slow launch.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const ROOT = join(__dirname, '..', '..', '..', '..');
const source = (relative: string) => readFileSync(join(ROOT, relative), 'utf8');
/** Comment-stripped, so prose describing a timer can never stand in for one. */
const code = (relative: string) =>
  source(relative)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

function Probe() {
  const { elapsedMs, pastCeiling } = useStartupPresentation();
  return (
    <>
      <Text testID="elapsed">{String(elapsedMs)}</Text>
      <Text testID="ceiling">{pastCeiling ? 'past' : 'within'}</Text>
    </>
  );
}

/*
  Ordered first, deliberately.

  This project has no React act environment, so the fake-timer cases below leave React's queue in a
  state where a later `render` in the same file yields an empty tree — the failure mode documented in
  `settle-until-loaded.ts`. The one case here that renders has to run before them.
*/
describe('what this issue deliberately does not change', () => {
  it('leaves the presentation ceiling at the value #57 owns', () => {
    /*
      #58 is about *where* the notice appears, not *when*. The composed-bounds question — that the
      connectivity, session and journey bounds can sum past this ceiling — is #57's, and moving this
      number would silently answer it.
    */
    expect(STARTUP_PRESENTATION_CEILING_MS).toBe(10_000);
  });

  it('leaves the approved wording alone', () => {
    expect(STARTUP_RESOLVING_MESSAGE).toBe('Still getting things ready…');
  });

  it('reports a launch that has only just begun when no provider is above it', async () => {
    /*
      The context default. It exists so a consumer is a plain read with no null branch, and its
      direction is the safe one: `within` means show nothing, so a missing provider degrades to the
      behaviour that existed before this change rather than to a notice at the wrong moment. It can
      admit nobody to anything — presentation state is never consulted for access.
    */
    const view = await render(<Probe />);
    expect(view.getByTestId('elapsed').props.children).toBe('0');
    expect(view.getByTestId('ceiling').props.children).toBe('within');
  });
});

describe('the clock is owned in one place', () => {
  it('is mounted in AppProviders, so every launch path has one', () => {
    /*
      The structural guarantee, asserted the same way recovery containment's owner is: a provider that
      only the entry gate mounted is exactly the defect. `AppProviders` is rendered by the root
      layout, which mounts for every route however the launch started.
    */
    const providers = code('src/application/providers/app-providers.tsx');
    expect(providers).toContain('<StartupPresentationProvider>');
    expect(providers).toContain("from '@application/startup/startup-presentation-provider'");
  });

  it('is read, not re-created, by the startup routing hook', () => {
    /*
      The hook must not keep a clock of its own. Two would be two launches: each measures from its
      own `Date.now()`, so the second would report a shorter launch than the first and the ceiling
      would arrive twice at different moments.
    */
    const hook = code('src/application/startup/use-startup-routing.ts');
    expect(hook).toContain('useStartupPresentation()');
    expect(hook).not.toContain('setInterval');
    expect(hook).not.toContain('TICK_MS =');
  });

  it('is read, not re-created, by the surface the boundary renders', () => {
    const surface = code('src/application/startup/startup-wait-presentation.tsx');
    expect(surface).toContain('useStartupPresentation()');
    expect(surface).not.toContain('setInterval');
    expect(surface).not.toContain('setTimeout');
  });

  it('has exactly one interval in the provider itself', () => {
    const provider = code('src/application/startup/startup-presentation-provider.tsx');
    expect(provider.match(/setInterval/g)).toHaveLength(1);
    /* Cleared on unmount, and cleared again when the ceiling is reached so it stops ticking. */
    expect(provider.match(/clearInterval/g)).toHaveLength(2);
  });
});

describe('the timer', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('creates one interval for one mount', async () => {
    const spy = jest.spyOn(global, 'setInterval');
    await render(
      <StartupPresentationProvider>
        <Probe />
      </StartupPresentationProvider>,
    );
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[1]).toBe(STARTUP_PRESENTATION_TICK_MS);
    spy.mockRestore();
  });

  it('still has one running inside a Strict Mode tree', async () => {
    /*
      Strict Mode mounts, tears down and mounts again on purpose. Two intervals are *created*; the
      cleanup clears the first before the second exists, so one survives — which is what the counts
      below say. Asserting only on creations would pass a provider that leaked one.
    */
    const created = jest.spyOn(global, 'setInterval');
    const cleared = jest.spyOn(global, 'clearInterval');
    await render(
      <StrictMode>
        <StartupPresentationProvider>
          <Probe />
        </StartupPresentationProvider>
      </StrictMode>,
    );
    expect(created.mock.calls.length - cleared.mock.calls.length).toBe(1);
    created.mockRestore();
    cleared.mockRestore();
  });

  it('advances the launch clock and crosses the ceiling exactly once', async () => {
    await render(
      <StartupPresentationProvider>
        <Probe />
      </StartupPresentationProvider>,
    );
    expect(screen.getByTestId('ceiling').props.children).toBe('within');

    await act(async () => {
      jest.advanceTimersByTime(STARTUP_PRESENTATION_CEILING_MS - STARTUP_PRESENTATION_TICK_MS);
      await Promise.resolve();
    });
    /* One tick short of the ceiling is still within it — the comparison is `>=`, not `>`. */
    expect(screen.getByTestId('ceiling').props.children).toBe('within');

    await act(async () => {
      jest.advanceTimersByTime(STARTUP_PRESENTATION_TICK_MS);
      await Promise.resolve();
    });
    expect(screen.getByTestId('ceiling').props.children).toBe('past');
  });

  it('stops ticking once the ceiling is reached, rather than running for the process', async () => {
    await render(
      <StartupPresentationProvider>
        <Probe />
      </StartupPresentationProvider>,
    );
    await act(async () => {
      jest.advanceTimersByTime(STARTUP_PRESENTATION_CEILING_MS);
      await Promise.resolve();
    });
    const atCeiling = screen.getByTestId('elapsed').props.children;

    await act(async () => {
      jest.advanceTimersByTime(STARTUP_PRESENTATION_CEILING_MS * 3);
      await Promise.resolve();
    });
    /*
      Frozen. Past the ceiling nothing reads the number any more — both consumers only ask whether it
      has been crossed — so continuing to re-render every 100 ms for the life of a stuck launch would
      be work with no reader.
    */
    expect(screen.getByTestId('elapsed').props.children).toBe(atCeiling);
  });

  it('issues no update after its tree is gone', async () => {
    const view = await render(
      <StartupPresentationProvider>
        <Probe />
      </StartupPresentationProvider>,
    );
    const created = jest.spyOn(global, 'setInterval');
    const cleared = jest.spyOn(global, 'clearInterval');
    /* Remount under the spies, so the id being cleared is one this test can name. */
    const fresh = await render(
      <StartupPresentationProvider>
        <Probe />
      </StartupPresentationProvider>,
    );
    const mine = created.mock.results[0]?.value as unknown;
    await view.unmount();
    await fresh.unmount();
    await act(async () => {
      await Promise.resolve();
    });

    /*
      The interval this provider created is the one that must be cleared. Asserted by id rather than
      by a global timer count, because the test environment keeps several of its own — the safe-area
      double and React Native's internals among them — so a count can never distinguish a leak here
      from unrelated background work.

      If the cleanup were missing, the interval would keep calling `setState` on an unmounted tree,
      which React tolerates in silence.
    */
    expect(mine).toBeDefined();
    expect(cleared.mock.calls.map((call) => call[0])).toContain(mine);
    created.mockRestore();
    cleared.mockRestore();
  });
});
