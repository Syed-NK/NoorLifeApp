import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  claimPendingFlow,
  clearPendingFlows,
  MAX_PENDING_FLOWS,
  newPendingFlowId,
  NL_RID_PATTERN,
  PENDING_FLOW_TTL_MS,
  rememberPendingFlow,
} from '../pending-auth-flow';

/**
 * NoorLife's record that this device asked for an email link.
 *
 * ── Why this suite uses real storage rather than a stub ─────────────────────
 * The whole point of the record is that it survives things a stub cannot model: the app being
 * backgrounded, Android killing the process, a cold launch, a device restart. Those all reduce to the
 * same testable claim — *the module re-reads its state from storage rather than from a module-scope
 * variable* — and only a real read can prove it. `jest.setup.ts` provides in-memory doubles for both
 * `expo-secure-store` and AsyncStorage, so the reads are genuine and no device is involved.
 *
 * A process restart is simulated with `jest.resetModules()` plus a fresh `require`, which throws away
 * every module-level binding while leaving the storage doubles intact. That is exactly the shape of a
 * cold launch.
 */

beforeEach(async () => {
  await clearPendingFlows();
});

describe('minting an id', () => {
  it('produces the documented shape', () => {
    expect(newPendingFlowId()).toMatch(NL_RID_PATTERN);
  });

  it('does not repeat', () => {
    const ids = new Set(Array.from({ length: 32 }, () => newPendingFlowId()));
    // Distinctness is the property the record depends on: two flows sharing an id would let one
    // callback consume the other's record.
    expect(ids.size).toBe(32);
  });
});

describe('claiming a record', () => {
  it('returns the flow that was recorded', async () => {
    const id = await rememberPendingFlow('recovery');

    expect(await claimPendingFlow(id)).toEqual({ status: 'ok', flow: 'recovery' });
  });

  it('refuses an id that was never issued', async () => {
    await rememberPendingFlow('recovery');

    expect(await claimPendingFlow('0'.repeat(32))).toEqual({ status: 'unknown' });
  });

  it.each([
    ['an empty string', ''],
    ['a short value', 'abc'],
    ['upper-case hex, which this module never mints', 'A'.repeat(32)],
    ['a value carrying a separator', `${'a'.repeat(30)}/x`],
    ['a non-string', 42],
    ['null', null],
  ])('refuses %s as malformed without touching storage', async (_label, value) => {
    const id = await rememberPendingFlow('recovery');

    expect(await claimPendingFlow(value)).toEqual({ status: 'malformed' });
    // The genuine record is untouched: a malformed lookup must not be able to consume anything.
    expect(await claimPendingFlow(id)).toMatchObject({ status: 'ok' });
  });

  it('consumes the record, so a replay is refused', async () => {
    const id = await rememberPendingFlow('recovery');

    expect(await claimPendingFlow(id)).toMatchObject({ status: 'ok' });
    // The second claim is the replay. It has to fail on storage, not on a flag someone could forget
    // to set — which is why the record is deleted at claim time rather than after a successful
    // exchange.
    expect(await claimPendingFlow(id)).toEqual({ status: 'unknown' });
  });

  it('leaves other records alone when one is claimed', async () => {
    const recovery = await rememberPendingFlow('recovery');
    const signup = await rememberPendingFlow('signup');

    await claimPendingFlow(recovery);

    expect(await claimPendingFlow(signup)).toEqual({ status: 'ok', flow: 'signup' });
  });

  it('keeps a signup and a recovery apart', async () => {
    // Two email flows open at once is the case that made the SDK's `sb_flow_id` necessary; the same
    // case must not confuse *our* discriminator either.
    const signup = await rememberPendingFlow('signup');
    const recovery = await rememberPendingFlow('recovery');

    expect(await claimPendingFlow(signup)).toEqual({ status: 'ok', flow: 'signup' });
    expect(await claimPendingFlow(recovery)).toEqual({ status: 'ok', flow: 'recovery' });
  });
});

describe('expiry', () => {
  it('refuses a record past its TTL', async () => {
    const now = 1_000_000;
    const id = await rememberPendingFlow('recovery', now);

    expect(await claimPendingFlow(id, now + PENDING_FLOW_TTL_MS + 1)).toEqual({
      status: 'unknown',
    });
  });

  it('honours a record inside its TTL', async () => {
    const now = 1_000_000;
    const id = await rememberPendingFlow('recovery', now);

    expect(await claimPendingFlow(id, now + PENDING_FLOW_TTL_MS - 1)).toMatchObject({
      status: 'ok',
    });
  });

  it('drops expired records rather than letting them accumulate', async () => {
    const now = 1_000_000;
    await rememberPendingFlow('recovery', now);
    const fresh = await rememberPendingFlow('signup', now + PENDING_FLOW_TTL_MS + 1);

    expect(await claimPendingFlow(fresh, now + PENDING_FLOW_TTL_MS + 2)).toMatchObject({
      status: 'ok',
    });
  });
});

describe('bounds', () => {
  it('evicts oldest-first past the ceiling, keeping the newest request', async () => {
    const ids: string[] = [];
    for (let index = 0; index <= MAX_PENDING_FLOWS; index += 1) {
      // Sequential on purpose: the order records are written in is the order eviction respects.
      ids.push(await rememberPendingFlow('recovery'));
    }

    // The newest must always survive — it is the link the user is about to open.
    expect(await claimPendingFlow(ids[ids.length - 1])).toMatchObject({ status: 'ok' });
    expect(await claimPendingFlow(ids[0])).toEqual({ status: 'unknown' });
  });
});

describe('surviving a process restart', () => {
  it('honours a record written before the module was torn down', async () => {
    const id = await rememberPendingFlow('recovery');

    /**
     * A cold launch, as far as JavaScript is concerned.
     *
     * Every module-level binding in `pending-auth-flow.ts` is discarded and the file is evaluated
     * again; the storage doubles are not reset. If the record had been held in memory this claim
     * would come back `unknown`, which is precisely the failure a memory-only design would ship.
     */
    jest.resetModules();
    // A static import is hoisted and would bind the pre-reset module, which is the exact thing this
    // case needs to discard.
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- see above.
    const reloaded = require('../pending-auth-flow') as typeof import('../pending-auth-flow');

    expect(await reloaded.claimPendingFlow(id)).toEqual({ status: 'ok', flow: 'recovery' });
  });

  it('still refuses a consumed record after a restart', async () => {
    const id = await rememberPendingFlow('recovery');
    await claimPendingFlow(id);

    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- see the case above.
    const reloaded = require('../pending-auth-flow') as typeof import('../pending-auth-flow');

    // Consumption is durable too, or a replay would succeed simply by killing the app first.
    expect(await reloaded.claimPendingFlow(id)).toEqual({ status: 'unknown' });
  });
});

describe('what is written down', () => {
  it('stores nothing but the id, the flow and two timestamps', async () => {
    await rememberPendingFlow('recovery');

    const raw = (await SecureStore.getItemAsync('noorlife.auth.pendingFlows')) ?? '[]';
    const records = JSON.parse(raw) as Record<string, unknown>[];

    expect(records).toHaveLength(1);
    // Asserted as an exact key set, not a "does not contain a token" check: a new field is the way a
    // secret would arrive here, and an allow-list is what fails when one does.
    expect(Object.keys(records[0] ?? {}).sort()).toEqual(['createdAt', 'expiresAt', 'flow', 'id']);
  });

  it('recovers from corrupt storage by treating it as empty', async () => {
    await SecureStore.setItemAsync('noorlife.auth.pendingFlows', 'not json at all');

    // Refusing the link is the safe direction. Throwing here would surface as an unhandled rejection
    // inside the callback screen.
    expect(await claimPendingFlow('a'.repeat(32))).toEqual({ status: 'unknown' });
  });

  it('discards entries that are not records this module wrote', async () => {
    await SecureStore.setItemAsync(
      'noorlife.auth.pendingFlows',
      JSON.stringify([{ id: 'not-a-valid-id', flow: 'recovery', createdAt: 0, expiresAt: 1e15 }]),
    );

    expect(await claimPendingFlow('not-a-valid-id')).toEqual({ status: 'malformed' });
  });

  it('keeps nothing in AsyncStorage while secure storage is available', async () => {
    await rememberPendingFlow('recovery');

    // The split `session-storage.ts` establishes: security-relevant state does not sit in plain
    // storage on a device that has a keystore.
    expect(await AsyncStorage.getItem('noorlife.auth.pendingFlows')).toBeNull();
  });
});

/**
 * The source scan the module's own header promises.
 *
 * The runtime assertions above prove that today's code writes only four keys. They cannot prove that
 * tomorrow's does not *reach for* something it should never hold — a field added behind a branch these
 * tests do not take would pass every one of them. So the file is also read as text.
 *
 * This is a blunt instrument on purpose, and it lives here rather than in a separate scan suite so
 * that the claim and the thing it constrains stay in one place.
 */
describe('the module never reaches for a secret', () => {
  const source = readFileSync(join(__dirname, '..', 'pending-auth-flow.ts'), 'utf8');

  /**
   * Comments are stripped before scanning.
   *
   * The header documents exactly what may never be stored, so it names every forbidden term. Scanning
   * the raw file would match that prose and fail permanently — the documentation would be the defect.
   */
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it.each([
    'access_token',
    'accessToken',
    'refresh_token',
    'refreshToken',
    'code_verifier',
    'codeVerifier',
    'error_description',
    'sb_flow_id',
    'password',
  ])('does not mention %s outside its own documentation', (term) => {
    expect(code).not.toContain(term);
  });

  it('does not read the callback URL or anything off it', () => {
    // The record is minted before a link exists and matched by id afterwards. This module has no
    // business parsing a URL, and a URL is the one place a code or token could arrive.
    expect(code).not.toContain('parseAuthCallback');
    expect(code).not.toMatch(/noorlifeapp:\/\//);
  });
});
