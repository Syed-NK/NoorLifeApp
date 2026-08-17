import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The temporary offline-authentication instrumentation is gone, and stays gone.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Why this outlives the thing it deleted ─────────────────────────────────
 * A diagnostic build was necessary: three defects in the launch path were invisible to a passing
 * unit suite and only a device would show them. It emitted closed enums into a hidden view, never a
 * log line, and it identified all three.
 *
 * That kind of instrumentation is exactly what quietly becomes permanent — it is useful, it is one
 * flag away from being harmless, and nobody notices it shipping. So its removal is asserted rather
 * than remembered. If any part of it returns, this fails and somebody has to justify it in a review
 * instead of in a hurry.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const SRC = join(__dirname, '..', '..', '..');

function sources(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') {
        found.push(...sources(path));
      }
    } else if (/\.tsx?$/.test(entry.name)) {
      found.push(path);
    }
  }
  return found;
}

/** Every identifier and literal the instrumentation introduced. */
const REMOVED = [
  'OFFLINE_AUTH_DIAGNOSTICS',
  'offline-auth-diagnostics',
  'recordDiagnostic',
  'diagnosticSequence',
  'subscribeToDiagnostics',
  'classifySecureReadError',
  'OfflineAuthDiagnosticNode',
  'offline-auth-diagnostics',
  'secure_read',
  'read_threw',
  'confirmed_offline',
  'link_present',
  'terminal_auth_failure',
  'retryable_network_failure',
  'invalid_schema',
  'forbidden_field',
  'not_adopted',
] as const;

describe('the temporary launch instrumentation', () => {
  it('has no module left', () => {
    const present = sources(SRC)
      .map((path) => path.replace(SRC, '').replace(/\\/g, '/'))
      .filter((path) => path.includes('offline-auth-diagnostics'));

    /* This file is the only one permitted to mention the name. */
    expect(present).toEqual(['/services/auth/__tests__/offline-auth-diagnostics-removed.test.ts']);
  });

  it('leaves no identifier or diagnostic literal anywhere in the bundle', () => {
    const offenders: string[] = [];
    for (const path of sources(SRC)) {
      if (path.endsWith('offline-auth-diagnostics-removed.test.ts')) {
        continue;
      }
      const source = readFileSync(path, 'utf8');
      for (const token of REMOVED) {
        if (source.includes(token)) {
          offenders.push(`${path.replace(SRC, '').replace(/\\/g, '/')} :: ${token}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('leaves no diagnostic node in the provider tree', () => {
    const provider = readFileSync(
      join(SRC, 'application', 'providers', 'auth-provider.tsx'),
      'utf8',
    );
    expect(provider).not.toContain('testID="offline-auth-diagnostics"');
    /* And the provider is back to rendering its children directly. */
    expect(provider).toContain(
      '<AuthActionsContext.Provider value={actions}>{children}</AuthActionsContext.Provider>',
    );
  });

  it('still logs nothing on the authentication path', () => {
    /*
      The standing rule the diagnostics were written around, re-asserted now they are gone: these
      modules print nothing, so a token, an id or an address cannot reach logcat from here.
    */
    for (const file of ['offline-receipt.ts', 'session-resolution.ts']) {
      const source = readFileSync(join(SRC, 'services', 'auth', file), 'utf8');
      expect(source).not.toMatch(/\bconsole\.(log|warn|error|info|debug)\s*\(/);
    }

    /*
      `auth.service.ts` is the one exception, and it is left exactly as it is rather than tightened.
      Its `logAuthFailure` is `__DEV__`-gated, silent in production, and documented as printing the
      classification only — never the payload, session, access or refresh token, password, OTP or
      key. What has to hold is that the gate stays, so that is what is asserted; asserting the
      absence of the call would fail against a deliberate, pre-existing developer diagnostic.
    */
    const service = readFileSync(join(SRC, 'services', 'auth', 'auth.service.ts'), 'utf8');
    expect(service).toMatch(/function logAuthFailure[\s\S]{0,200}?if \(!__DEV__\) \{\s*return;/);
  });
});
