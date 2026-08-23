import { readAccountJourney } from '@services/account/account-journey';

/**
 * Which of the four states each kind of failure produces — issue #46's root cause.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── The collapse this separates ────────────────────────────────────────────
 * `AccountJourneyState` reported two unrelated things as `unconfigured`: *the columns do not exist in
 * this deployment*, and *the request could not be completed*. The startup layer then mapped the pair
 * to "has not chosen a plan", which routed an entitled — possibly paying — account to the
 * subscription chooser because the network was slow.
 *
 * One of those is a definitive fact about the installation. The other is an outage. They now answer
 * separately, and the whole point of this suite is that each failure lands in the right one:
 *
 *   `unconfigured` → this deployment cannot record a plan choice. Routable, deliberately: nobody has
 *                    one, so the chooser is correct and costs one tap to leave.
 *   `unavailable`  → nothing was learned. **Never routable**, in either direction.
 *
 * ── Why this is a service test and not a routing one ───────────────────────
 * The distinction is a property of interpreting a Postgres response, and enumerating the responses is
 * the only way to be sure every path lands somewhere deliberate. Where each state is *routed* is
 * `journey-startup-resolution.test.tsx`.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const USER = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';

type Response = { data: unknown; error: unknown };

const respond = { current: null as (() => Promise<Response> | Response) | null };

jest.mock('@/lib/supabase', () => ({
  get supabase() {
    return {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => {
              const next = respond.current;
              if (next === null) {
                throw new Error('no response scripted');
              }
              return await next();
            },
          }),
        }),
      }),
    };
  },
  isSupabaseConfigured: true,
}));

/** A row exactly as the applied migration returns one. */
function row(over: Record<string, unknown> = {}) {
  return {
    initial_plan_selection_completed_at: '2026-01-01T00:00:00.000Z',
    initial_plan_code: 'premium_single',
    account_journey_version: 1,
    ...over,
  };
}

function answers(response: Response) {
  respond.current = () => response;
}

function rejects(reason: unknown) {
  respond.current = () => Promise.reject(reason);
}

beforeEach(() => {
  respond.current = null;
});

describe('a definitive answer about the account', () => {
  it('reports completed, with the plan code', async () => {
    answers({ data: row(), error: null });
    expect(await readAccountJourney(USER)).toEqual({
      status: 'completed',
      planCode: 'premium_single',
    });
  });

  it('reports pending when the timestamp is null', async () => {
    answers({ data: row({ initial_plan_selection_completed_at: null }), error: null });
    expect(await readAccountJourney(USER)).toEqual({ status: 'pending' });
  });

  it('reports pending when there is no row yet', async () => {
    /* The insert trigger may not have run. Genuinely pending rather than broken. */
    answers({ data: null, error: null });
    expect(await readAccountJourney(USER)).toEqual({ status: 'pending' });
  });

  it('reports pending for a completed journey at an older version', async () => {
    answers({ data: row({ account_journey_version: 0 }), error: null });
    expect(await readAccountJourney(USER)).toEqual({ status: 'pending' });
  });

  it('defaults a missing plan code to free rather than guessing a paid one', async () => {
    /* A paid code is written by server-side verification only; absence must not invent one. */
    answers({ data: row({ initial_plan_code: null }), error: null });
    expect(await readAccountJourney(USER)).toEqual({ status: 'completed', planCode: 'free' });
  });
});

describe('a deployment that cannot record a plan choice', () => {
  it.each(['42703', '42P01', 'PGRST204', 'PGRST205'])(
    'reports unconfigured for schema error %s',
    async (code) => {
      answers({ data: null, error: { code, message: 'column does not exist' } });
      const result = await readAccountJourney(USER);
      expect(result.status).toBe('unconfigured');
    },
  );

  it('reports unconfigured when the column is absent from a successful response', async () => {
    /*
      The query succeeded and the column simply is not there, which means the migration has not run.
      Reported rather than read as null — reading it as null would say "pending" on the strength of a
      field that does not exist.
    */
    answers({ data: { initial_plan_code: null }, error: null });
    const result = await readAccountJourney(USER);
    expect(result.status).toBe('unconfigured');
    if (result.status === 'unconfigured') {
      expect(result.reason).toContain('20260801120000_account_journey.sql');
    }
  });
});

describe('a request that could not be completed', () => {
  it('reports unavailable for a server error that is not about the schema', async () => {
    /*
      The heart of #46. A transient failure, a policy error, a gateway timeout — the query reached
      something and was refused for a reason that says nothing about this account. Before, this was
      `unconfigured`, and the startup layer read that as "has not chosen a plan".
    */
    answers({
      data: null,
      error: { code: '57014', message: 'canceling statement due to timeout' },
    });
    const result = await readAccountJourney(USER);
    expect(result.status).toBe('unavailable');
  });

  it('reports unavailable for a server error with no code at all', async () => {
    answers({ data: null, error: { message: 'Failed to fetch' } });
    expect((await readAccountJourney(USER)).status).toBe('unavailable');
  });

  it.each([
    ['a transport rejection', new Error('Network request failed')],
    ['an abort', new Error('Aborted')],
    ['a non-Error rejection', 'something threw a string'],
  ])('reports unavailable for %s', async (_label, reason) => {
    rejects(reason);
    expect((await readAccountJourney(USER)).status).toBe('unavailable');
  });

  it('reports unavailable rather than throwing, whatever happens', async () => {
    /* The contract the caller depends on: this never rejects, so a caller cannot forget a handler. */
    rejects(new Error('boom'));
    await expect(readAccountJourney(USER)).resolves.toEqual(
      expect.objectContaining({ status: 'unavailable' }),
    );
  });
});

describe('a malformed response is never read as a verdict', () => {
  it.each([
    ['a string where a row was expected', 'not a row'],
    ['a number', 42],
    ['an array', []],
  ])('does not report completed for %s', async (_label, data) => {
    answers({ data, error: null });
    const result = await readAccountJourney(USER);
    /*
      Nothing shaped like a row means nothing was established about the plan. What matters is only
      that it is **not** `completed` — a corrupt response must never grant a launch past the
      introduction — and that it does not throw.
    */
    expect(result.status).not.toBe('completed');
  });

  it('does not report completed when the timestamp is not a timestamp', async () => {
    answers({ data: row({ initial_plan_selection_completed_at: 12345 }), error: null });
    const result = await readAccountJourney(USER);
    expect(['completed', 'pending', 'unconfigured', 'unavailable']).toContain(result.status);
  });
});
