import { render, screen, waitFor } from '@testing-library/react-native';
import { StrictMode, useEffect } from 'react';
import { Text } from 'react-native';

import { AppProviders } from '@application/providers/app-providers';
import { useAuthCallbackActions } from '@application/providers/auth-callback-provider';
import { ProtectedRouteBoundary } from '@application/navigation/protected-route-boundary';
import {
  clearRecoveryPending,
  readRecoveryPending,
  writeRecoveryPending,
} from '@services/auth/recovery-pending';

import { installMockLatencyTimers } from '@/test-support/mock-latency-timers';

/**
 * **A contained session mounts no protected screen** — issue #30, asserted by rendering.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Why this exists alongside the structural suite ─────────────────────────
 * `recovery-containment-boundary.test.ts` proves the *shape*: one actor, no side effects in the gate,
 * the policy, and the decision for every input. Two of #30's requirements cannot be proved that way
 * and are proved here instead:
 *
 *   • that a protected child genuinely does not mount while a recovery is open — a source scan can
 *     show `children` is not referenced on a branch, but not that the branch is the one taken;
 *   • that a double render, including Strict Mode's deliberate one, produces no duplicated
 *     navigation and no duplicated clean-up.
 *
 * ── The session these tests run under ──────────────────────────────────────
 * `AppProviders` with the mocked auth service, which resolves to a signed-in user. That is the state
 * the defect requires: containment only matters for somebody who *is* signed in, because a recovery
 * exchange establishes a real session before the password is set. A signed-out visitor is turned away
 * by the authentication boundary before the recovery gate is reached at all.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * The id the mocked auth service signs in as.
 *
 * It has to match the live session exactly: a marker for anybody else resolves to `sign-out`, which
 * is a different (and also correct) outcome that would quietly stand in for containment here. Shared
 * with the auth-callback suites, which use the same value against the same mock.
 */
const SESSION_USER_ID = 'test-user-id';

function Protected() {
  return <Text testID="protected-child">protected</Text>;
}

/** Mints the grant a successful exchange leaves behind, the way the real callback screen does. */
function GrantRecovery() {
  const { grantRecovery } = useAuthCallbackActions();
  useEffect(() => {
    grantRecovery({ userId: SESSION_USER_ID });
  }, [grantRecovery]);
  return null;
}

/** Releases it, the way the password screen does on success, cancel, Back or "new link". */
function ReleaseRecovery() {
  const { clearRecovery } = useAuthCallbackActions();
  useEffect(() => {
    clearRecovery();
  }, [clearRecovery]);
  return null;
}

function renderBoundary(extra?: React.ReactNode, strict = false) {
  const tree = (
    <AppProviders>
      {extra}
      <ProtectedRouteBoundary>
        <Protected />
      </ProtectedRouteBoundary>
    </AppProviders>
  );
  return render(strict ? <StrictMode>{tree}</StrictMode> : tree);
}

installMockLatencyTimers(async () => {
  await renderBoundary();
});

afterEach(async () => {
  await clearRecoveryPending();
});

describe('an open recovery blocks protected content', () => {
  it('redirects to the recovery screen instead of mounting the child', async () => {
    await renderBoundary(<GrantRecovery />);

    await waitFor(() => {
      expect(screen.getByTestId('router-redirect').props.accessibilityLabel).toBe(
        '/auth/set-new-password',
      );
    });
    /*
      The assertion that matters. Not "the child is hidden" — the child never mounted, so it issued no
      read. On a link into Planner that is the difference between a blank screen and a screen that has
      already opened somebody's task store.
    */
    expect(screen.queryByTestId('protected-child')).toBeNull();
  });

  it('blocks it on a cold launch where only the marker survives', async () => {
    /*
      The launch path the defect was about: the process died after the exchange, so storage holds the
      marker and nothing has minted a grant. Nothing in this test mints one — the actor inside
      `AppProviders` reads the marker, matches it against the live session and reconstructs it, which
      it could not do before because it only ran inside the entry route.
    */
    await writeRecoveryPending(SESSION_USER_ID);

    await renderBoundary();

    await waitFor(() => {
      expect(screen.getByTestId('router-redirect').props.accessibilityLabel).toBe(
        '/auth/set-new-password',
      );
    });
    expect(screen.queryByTestId('protected-child')).toBeNull();
  });

  /*
    The third case #30 asks about — *nothing protected mounts while the marker read is outstanding* —
    is deliberately not asserted by rendering. RNTL's `render` flushes effects before it resolves, so
    the wait window has closed by the time any query can run, and a test that appeared to assert it
    would really be asserting the settled state again.

    It is proved twice elsewhere instead, both deterministically:
      • `recovery-containment-boundary.test.ts` — `recoveryRouteAccess({recoveryOpen: false,
        resolved: false})` is `'wait'`, and the `wait` branch provably never references `children`;
      • the case above — with a marker present, the child is absent at every point this suite can
        observe, and a redirect is what appears in its place.
  */
});

describe('no recovery means no interference', () => {
  it('mounts the protected child once the read answers', async () => {
    await renderBoundary();

    await waitFor(() => expect(screen.getByTestId('protected-child')).toBeTruthy());
    expect(screen.queryByTestId('router-redirect')).toBeNull();
  });

  it('leaves the marker store untouched when there was nothing in it', async () => {
    await renderBoundary();

    await waitFor(() => expect(screen.getByTestId('protected-child')).toBeTruthy());
    expect(await readRecoveryPending()).toEqual({ status: 'none' });
  });
});

describe('release happens exactly once, and restores normal routing', () => {
  it('mounts the child as soon as the grant is cleared', async () => {
    const view = await renderBoundary(
      <>
        <GrantRecovery />
        <ReleaseRecovery />
      </>,
    );

    /*
      Both effects run; the release is last. The gate reads the *live* grant rather than the
      launch-time verdict, so clearing it is the whole of the release — nothing has to tell the gate
      that the recovery finished, and there is no second place for a stale verdict to keep containing
      the user after they set their password.
    */
    await waitFor(() => expect(view.getByTestId('protected-child')).toBeTruthy());
    expect(view.queryByTestId('router-redirect')).toBeNull();
  });
});

describe('a double render duplicates nothing', () => {
  it('renders one redirect and no protected child under Strict Mode', async () => {
    /*
      Strict Mode renders components twice and runs effects twice on purpose. The gate survives it
      because it is pure: two renders of a declarative `<Redirect>` are one navigation, whereas an
      effect calling `router.replace` would have fired twice.
    */
    await writeRecoveryPending(SESSION_USER_ID);

    await renderBoundary(undefined, true);

    await waitFor(() => expect(screen.getAllByTestId('router-redirect')).toHaveLength(1));
    expect(screen.queryByTestId('protected-child')).toBeNull();
  });

  it('does not clear or rewrite the marker under Strict Mode', async () => {
    /*
      The clean-up half. A resumable recovery must be *resumed*, not consumed: the actor's `settled`
      latch means the decision is carried out once even though the effect runs twice, so the marker is
      still there for the password screen to complete against.
    */
    await writeRecoveryPending(SESSION_USER_ID);

    await renderBoundary(undefined, true);
    await waitFor(() => expect(screen.getAllByTestId('router-redirect')).toHaveLength(1));

    const read = await readRecoveryPending();
    expect(read.status).toBe('valid');
    expect(read.status === 'valid' ? read.marker.userId : null).toBe(SESSION_USER_ID);
  });

  it('holds containment across a re-render with new children', async () => {
    const view = await renderBoundary(<GrantRecovery />);
    await waitFor(() => expect(view.getByTestId('router-redirect')).toBeTruthy());

    // Re-rendering the same tree must not let the child slip through on the second pass.
    await view.rerender(
      <AppProviders>
        <GrantRecovery />
        <ProtectedRouteBoundary>
          <Protected />
        </ProtectedRouteBoundary>
      </AppProviders>,
    );

    expect(view.queryByTestId('protected-child')).toBeNull();
  });
});
