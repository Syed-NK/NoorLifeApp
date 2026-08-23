import { supabase } from '@/lib/supabase';
import { assertRemoteAccess } from '@services/network/remote-access';

/**
 * The post-signup journey: has this account chosen its initial plan?
 *
 * ── Why the server, not the device ──────────────────────────────────────────
 * This is a property of the account. A device-local flag would re-run the plan chooser on every new
 * phone the user signs in on, and lose the answer entirely on reinstall — asking a paying
 * subscriber to pick a plan again. So the record lives on `public.profiles`.
 *
 * ── Why an explicit "unconfigured" state ────────────────────────────────────
 * The migration that adds those columns is written but **not applied**. Until it is, the query
 * fails with an undefined-column error, and the brief is explicit about what must happen then:
 * fail safely and report configuration, *not* silently route new users to Home. So the outcomes are
 * distinguished rather than collapsed, and the caller decides. Collapsing "we cannot tell" into
 * "completed" is exactly the bug that sends a new account straight past the subscription
 * introduction.
 *
 * ── Why "unconfigured" and "unavailable" are not the same answer ────────────
 * They were, and that was a defect: this type reported both "the columns do not exist" and "the
 * request could not complete" as `unconfigured`, and the caller mapped the pair to *has not chosen a
 * plan*. One of those is a definitive fact about the deployment; the other is an outage. Treating an
 * outage as a verdict routed a paying account to the subscription chooser because the network was
 * slow — issue #46, measured on both targets.
 *
 * So they are separate members now:
 *
 *   • `unconfigured` — this deployment **cannot record** a plan choice. The migration has not run, or
 *     the build has no backend at all. Nothing is wrong with the request; there is nowhere for the
 *     answer to live.
 *   • `unavailable` — the request **could not be completed**: no route, a captive portal, a server
 *     that never answered, a transport failure, or a bound elapsing at the caller.
 *
 * ── Both are unknown, and neither may route ────────────────────────────────
 * They are kept apart because the *diagnosis* differs — one names a migration to apply, the other a
 * network to fix — and a caller that could not tell them apart could not report either usefully. But
 * neither says anything about this account, so neither may produce a routing verdict.
 *
 * `unconfigured` briefly did, on the reasoning that a deployment with nowhere to store the answer has
 * no accounts that chose a plan, so showing the chooser was harmless. It is not harmless: it invents a
 * purchase decision to preserve availability, and it does so for exactly the person it hurts most — a
 * subscriber whose backend is mis-deployed, shown a plan chooser as though they had never chosen.
 * Absence of a place to record the answer is not the answer.
 */

/** The approved plan codes. Paid codes are written by server-side verification only. */
export type InitialPlanCode = 'free' | 'premium_single' | 'premium_family';

export const CURRENT_ACCOUNT_JOURNEY_VERSION = 1;

export type AccountJourneyState =
  /** The account has chosen a plan; startup may proceed to Main Home. */
  | { readonly status: 'completed'; readonly planCode: InitialPlanCode }
  /** The account still owes the plan introduction. */
  | { readonly status: 'pending' }
  /**
   * This deployment cannot record a plan choice: the migration has not run, or there is no backend.
   *
   * A statement about the *installation*, not about the account and not about the network. Reported,
   * never assumed, and **never routable** — the reason string names the migration so the deployment
   * can be fixed, which is the honest response to a build that cannot answer.
   */
  | { readonly status: 'unconfigured'; readonly reason: string }
  /**
   * The request could not be completed, so nothing was learned.
   *
   * **Not a verdict, and never routable as one.** A caller that maps this to "has not chosen a plan"
   * reintroduces #46. It may hold a launch; it may not conclude anything about the account.
   */
  | { readonly status: 'unavailable'; readonly reason: string };

/** Postgres error codes meaning "this schema does not have that". */
const MISSING_SCHEMA_CODES = new Set(['42703', '42P01', 'PGRST204', 'PGRST205']);

function describeMissingSchema(error: { code?: string; message?: string }): string {
  return (
    `profiles.initial_plan_selection_completed_at is not available ` +
    `(${error.code ?? 'unknown'}: ${error.message ?? 'no message'}). ` +
    `Apply supabase/migrations/20260801120000_account_journey.sql.`
  );
}

/**
 * Reads journey state for a user.
 *
 * Never throws. Every failure resolves to a reported state with a reason, so a caller cannot mistake
 * a backend problem for a completed journey — and cannot mistake an outage for a definitive answer
 * about the account either.
 */
export async function readAccountJourney(userId: string): Promise<AccountJourneyState> {
  if (supabase === null) {
    return { status: 'unconfigured', reason: 'Supabase is not configured in this build.' };
  }

  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('initial_plan_selection_completed_at, initial_plan_code, account_journey_version')
      .eq('id', userId)
      .maybeSingle();

    if (error !== null) {
      const code = (error as { code?: string }).code;
      if (code !== undefined && MISSING_SCHEMA_CODES.has(code)) {
        return { status: 'unconfigured', reason: describeMissingSchema(error) };
      }
      /*
        The query reached a server and the server refused for a reason that is not "no such column" —
        a transient failure, a policy error, a timeout at the edge. Nothing about the account was
        established, so this is an outage rather than a configuration fact.
      */
      return { status: 'unavailable', reason: error.message ?? 'Profile read failed.' };
    }

    if (data === null) {
      // No profile row yet — the insert trigger may not have run. Genuinely pending, not broken.
      return { status: 'pending' };
    }

    const row = data as {
      initial_plan_selection_completed_at?: string | null;
      initial_plan_code?: string | null;
      account_journey_version?: number | null;
    };

    if (row.initial_plan_selection_completed_at === undefined) {
      // The column is absent from the response, which means the migration has not run even though
      // the query itself succeeded. Reported rather than read as null.
      return { status: 'unconfigured', reason: describeMissingSchema({}) };
    }

    if (row.initial_plan_selection_completed_at === null) {
      return { status: 'pending' };
    }

    // A completed journey at an older version is re-run deliberately, the same way onboarding is.
    const version = row.account_journey_version ?? 1;
    if (version < CURRENT_ACCOUNT_JOURNEY_VERSION) {
      return { status: 'pending' };
    }

    return {
      status: 'completed',
      planCode: (row.initial_plan_code as InitialPlanCode | null) ?? 'free',
    };
  } catch (error) {
    /*
      A rejection rather than a resolved error: a DNS failure, a dropped socket, an abort. The request
      did not complete, so there is no answer to interpret — which is the definition of unavailable
      and emphatically not of "has not chosen a plan".
    */
    return {
      status: 'unavailable',
      reason: error instanceof Error ? error.message : 'Profile read failed.',
    };
  }
}

export type CompleteJourneyResult =
  { readonly ok: true } | { readonly ok: false; readonly reason: string };

/**
 * Records the initial plan choice.
 *
 * Only `free` may be written from the client. The paid codes are refused here *and* by a database
 * trigger — the client-side check gives an honest error message, and the trigger is what makes it
 * true even if this function is bypassed. A development mock purchase must never be able to produce
 * a production-valid paid entitlement.
 */
export async function completeAccountJourney(
  userId: string,
  planCode: InitialPlanCode,
): Promise<CompleteJourneyResult> {
  assertRemoteAccess('Finishing account setup');
  if (planCode !== 'free') {
    return {
      ok: false,
      reason:
        'Paid plan codes are written by server-side purchase verification, never by the client.',
    };
  }

  if (supabase === null) {
    return { ok: false, reason: 'Supabase is not configured in this build.' };
  }

  try {
    const { error } = await supabase
      .from('profiles')
      .update({
        initial_plan_selection_completed_at: new Date().toISOString(),
        initial_plan_code: planCode,
        account_journey_version: CURRENT_ACCOUNT_JOURNEY_VERSION,
      })
      .eq('id', userId);

    if (error !== null) {
      const code = (error as { code?: string }).code;
      if (code !== undefined && MISSING_SCHEMA_CODES.has(code)) {
        return { ok: false, reason: describeMissingSchema(error) };
      }
      return { ok: false, reason: error.message ?? 'Could not save your plan choice.' };
    }

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : 'Could not save your plan choice.',
    };
  }
}
