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
 * fail safely and report configuration, *not* silently route new users to Home. So the three
 * outcomes are distinguished — completed, pending, and unconfigured — and the caller decides.
 * Collapsing "we cannot tell" into "completed" is exactly the bug that sends a new account straight
 * past the subscription introduction.
 */

/** The approved plan codes. Paid codes are written by server-side verification only. */
export type InitialPlanCode = 'free' | 'premium_single' | 'premium_family';

export const CURRENT_ACCOUNT_JOURNEY_VERSION = 1;

export type AccountJourneyState =
  /** The account has chosen a plan; startup may proceed to Main Home. */
  | { readonly status: 'completed'; readonly planCode: InitialPlanCode }
  /** The account still owes the plan introduction. */
  | { readonly status: 'pending' }
  /** The columns do not exist yet, or the backend is unreachable. Reported, never assumed. */
  | { readonly status: 'unconfigured'; readonly reason: string };

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
 * Never throws. Every failure resolves to `unconfigured` with a reason, so a caller cannot mistake
 * a backend problem for a completed journey.
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
      return { status: 'unconfigured', reason: error.message ?? 'Profile read failed.' };
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
    return {
      status: 'unconfigured',
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
