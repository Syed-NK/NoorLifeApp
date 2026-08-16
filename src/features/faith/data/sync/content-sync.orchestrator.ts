import type {
  QuranContentEndpoint,
  QuranContentPayload,
  QuranEndpointFailure,
  WireMutation,
  WireSyncRow,
} from '../quran-foundation/quran-foundation.contract';
import { type ConnectivityPort, canSync } from '../connectivity/connectivity.port';
import {
  backoffDelayMs,
  clearSyncFailure,
  mayAttempt,
  MIN_ATTEMPT_INTERVAL_MS,
  readSyncHealth,
  recordSyncAttempt,
  recordSyncFailure,
  type SyncFailure,
  type SyncHealth,
} from '../../storage/faith-sync-checkpoint';
import type {
  RecitationRow,
  TranslationAttribution,
  TranslationRow,
} from '../../storage/faith-sync-rows';
import {
  type ActiveGeneration,
  checksumOf,
  type GenerationDraft,
  publishGeneration,
  readActiveGeneration,
  sweepGenerations,
} from '../../storage/faith-sync-generation';
import { RECITATION_CHECK_INTERVAL_MS } from '../../storage/faith-recitation-check';
import { publishRevision, updateSyncStatus } from './content-sync.revision';
import type { SyncSessionGuard } from './content-sync.session';

/**
 * The Content Sync transaction — the one place a sync run happens.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── What was missing, and why the parts alone were not enough ───────────────
 * `faith-sync-checkpoint.ts`, `faith-sync-rows.ts` and `faith-audio-manifest.ts` were all built,
 * tested, and called by nothing. Each is correct in isolation and none of them can be correct alone:
 * the guarantee that matters — *the token advances only after every page and every required snapshot
 * has been applied* — is a property of the **order** they are used in, and an order has to live
 * somewhere. This is that somewhere.
 *
 * `faith-sync-checkpoint.ts` survives here for **failure and backoff state only**. It holds no token,
 * no sequence and no successful-publication timestamp, and there is no field on it that could carry
 * one — every authoritative fact about a successful sync comes from the active generation manifest.
 *
 * ── The transaction, and the correction that made it one ───────────────────
 * A sync token is a claim that everything before it has been applied.
 *
 * **This module used to break that claim, and the comment here used to deny it.** Publication was
 * four sequential durable writes — translations, recitations, the audio clock, the token — and a
 * process death or a failed write between any two of them left one resource from this run beside
 * another from the last. Deferring all four to the end of the function made the window smaller. It
 * did not make the sequence atomic, and describing it as atomic was wrong.
 *
 * What is true now, stated precisely:
 *
 *   1. single-flight guard  — one transaction per process, however many screens ask
 *   2. read the active generation — its presence decides incremental; its absence decides bootstrap
 *   3. fetch every page     — until `hasMore === false`, following the cursor the server extracted
 *   4. **validation is completed before publication** — no byte is visible while anything is unchecked
 *   5. fetch required snapshots and validate them in full
 *   6. **generation files are staged privately** — `.part`, reopened, renamed, manifest written last
 *   7. **one pointer flip publishes the entire generation** — a single small AsyncStorage write
 *   8. **every transaction belongs to the authenticated session that started it** — and an ended one
 *      publishes nothing, announces nothing and writes no status
 *
 * ── Session ownership, and the defect it closes ────────────────────────────
 * Detaching a listener stops new triggers; it does nothing to a run already under way. A transaction
 * started before a sign-out used to survive it — free to fetch a further page, stage a generation,
 * flip the pointer and tell the *next* user's UI that their session had just synchronised.
 *
 * Every run now holds a `SyncSessionGuard` and consults it at five points: before the first request,
 * after every awaited request, before staging, in the instruction immediately before the pointer
 * write, and before the revision is announced. The fourth is the boundary — the pointer write is the
 * only moment anything becomes visible, so a session invalidated before it leaves the previous
 * generation active and returns `session-ended`. Invalidated *after* it, the publication is a fact
 * and is reported as one; what the ended owner still may not do is speak to the status channel.
 *
 * Nothing here aborts an in-flight request. The answer arrives and is discarded unread, which is the
 * honest guarantee this boundary can actually make — see `content-sync.session.ts`.
 *
 * **The token is part of that generation**, not a separate record written before or after it. It sits
 * in the same directory as the content it acknowledges and becomes visible by the same pointer write.
 *
 * **A process death cannot expose mixed synchronised resources.** Before the pointer write the
 * previous generation is active and whole; after it the new one is active and whole; nothing reads
 * anything but the pointer, so there is no third state to be in.
 *
 * The large datasets are file-backed for a second reason: the live snapshots measured
 * `over_2_to_4_mib` and `over_4_to_8_mib`, and multi-megabyte JSON in AsyncStorage is a production
 * failure no in-memory test double would reveal. See `faith-sync-generation.ts`.
 *
 * ── Provisional assumption A1, named where it is implemented ───────────────
 * The feed has **never emitted a recitation mutation**. Not once, across every verified run — see
 * `docs/QURAN_FOUNDATION_AUDIO_PERMISSION.md` §8.4. The recitation snapshot is live-verified, so when
 * the seven-connected-day check falls due and no recitation mutation has arrived, this module
 * re-fetches the approved `recitations:3` snapshot and reconciles it against the manifest.
 *
 * That is **assumption A1, provisional and pending Quran Foundation's written confirmation.** It is
 * recorded as `reconciliation: 'snapshot'` on the result, never as a mutation, and
 * `SyncOutcome.recitationMutationObserved` is `false` on every path that did not actually receive
 * one. Nothing in this file may set it true without a mutation having been read off the wire.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** The canonical filter. Fixed on the server; restated here only to bind the stored token to it. */
export const CANONICAL_SYNC_FILTER = 'recitations:3;translations:85';

/** The approved resource ids, from the permission table. Never widened from a response. */
export const SUDAIS_RESOURCE_ID = 3;
export const TRANSLATION_RESOURCE_ID = 85;

/** The complete ayah count of the Qur'an. A snapshot claiming completeness must produce exactly this. */
export const TOTAL_AYAH_COUNT = 6236;

/**
 * How long a connected device may go without reading the change feed.
 *
 * Seven days, from licence condition C7. It lives here rather than in a storage module because it is
 * a policy of the sync transaction, and the record it used to sit beside no longer holds any notion
 * of a successful sync to measure it from — the generation's `createdAt` does.
 *
 * A **check** obligation, never a deletion rule: passing it means a run is due. An offline device
 * accrues an owed check and keeps everything it has.
 */
export const SYNC_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

/** A page count that cannot be a real run. Guards against a server that never sets `hasMore: false`. */
const MAX_PAGES = 500;

/**
 * How a recitation reconciliation was reached.
 *
 * `mutation` may only be produced by an actual `resourceGroup: 'recitations'` mutation on the feed.
 * `snapshot` is assumption A1. `none` means neither was needed. The three are distinguished because
 * one of them is a licence interpretation awaiting confirmation and the other is the documented path.
 */
export type RecitationReconciliation = 'none' | 'mutation' | 'snapshot';

export type SyncOutcome =
  | {
      readonly kind: 'synced';
      readonly bootstrapped: boolean;
      readonly pages: number;
      /** Whether a recitation mutation was actually read off the feed. Never set optimistically. */
      readonly recitationMutationObserved: boolean;
      readonly recitationReconciliation: RecitationReconciliation;
      readonly translationsReplaced: boolean;
      readonly at: number;
    }
  /** Nothing was owed. The check is not due and no work was needed. */
  | { readonly kind: 'not-due' }
  /** A transaction was already running; this caller joined nothing and started nothing. */
  | { readonly kind: 'already-running' }
  /**
   * Refused by backoff or by the minimum gap between attempts.
   *
   * Distinct from `already-running`, which means another transaction is in flight *now*. This means
   * one ran or failed recently enough that starting another would be a loop — the state a flapping
   * connection produces, where each reconnect is a fresh trigger and none of them overlaps.
   */
  | { readonly kind: 'throttled'; readonly retryAfterMs: number }
  /**
   * The authenticated session that started this run ended before it finished.
   *
   * ── Why `publishedBeforeEnd` is on the outcome and not inferred ───────────
   * There is exactly one instruction in the whole transaction after which a publication is a fact:
   * the pointer write. A session can end on either side of it, and the two cases are genuinely
   * different — before it, the previous generation is still active and nothing happened; after it,
   * the new generation *is* active and saying otherwise would be a lie about durable state.
   *
   * So the ordering is reported rather than smoothed over. What is guaranteed in both cases is that
   * the ended owner emits no further status and no revision: `true` here means "published, and then
   * the session ended", never "published and told the UI about it".
   */
  | {
      readonly kind: 'session-ended';
      readonly publishedBeforeEnd: boolean;
      readonly at: number;
    }
  | { readonly kind: 'failed'; readonly failure: SyncFailure };

/** Endpoint failure → the checkpoint's closed vocabulary. No message ever crosses. */
function toSyncFailure(failure: QuranEndpointFailure): SyncFailure {
  switch (failure) {
    case 'offline':
      return 'offline';
    case 'authentication-required':
      return 'unauthorized';
    case 'rate-limited':
      return 'rate-limited';
    case 'invalid-response':
      return 'invalid-response';
    case 'not-configured':
    case 'timed-out':
    case 'not-found':
    case 'unavailable':
      return 'unavailable';
  }
}

export type ContentSyncDependencies = {
  readonly endpoint: QuranContentEndpoint;
  readonly connectivity: ConnectivityPort;
  readonly now: () => number;
  /**
   * The authenticated session this orchestrator belongs to.
   *
   * **Required, not optional.** An optional guard is a guard somebody forgets, and the thing being
   * prevented — an ended session publishing content — is invisible in every test that constructs
   * its own subject. Making it part of the type means an unowned transaction cannot be built.
   *
   * It carries `isValid()` and nothing else: no owner key, no token, no way to end anybody's
   * session. See `content-sync.session.ts`.
   */
  readonly session: SyncSessionGuard;
};

/**
 * What one run accumulates before anything is published.
 *
 * Held in memory for the whole run and handed to `publishGeneration` as one draft. Deferring the
 * writes is **not** what makes this atomic — the previous version deferred four writes and was still
 * not atomic. Atomicity comes from the publication itself: one directory, validated by reopening it,
 * made visible by one pointer write. This type is simply the shape of what goes in.
 */
type Staged = {
  translations: {
    readonly attribution: TranslationAttribution | null;
    readonly rows: readonly TranslationRow[];
  } | null;
  recitations: { readonly rows: readonly RecitationRow[] } | null;
  recitationMutationObserved: boolean;
  recitationReconciliation: RecitationReconciliation;
};

export type ContentSyncOrchestrator = {
  /**
   * Runs the transaction if one is owed. Returns what happened.
   *
   * `force` skips the due check — used by an explicit "check now" control — and still respects the
   * single-flight guard and connectivity.
   */
  readonly run: (options?: { readonly force?: boolean }) => Promise<SyncOutcome>;
  /** Whether a transaction is in flight. For a screen that wants to render "synchronising". */
  readonly isRunning: () => boolean;
};

export function createContentSyncOrchestrator(
  deps: ContentSyncDependencies,
): ContentSyncOrchestrator {
  /**
   * The single-flight guard.
   *
   * ── Why a promise and not a boolean ────────────────────────────────────────
   * Several screens mount at once and each wants to know the result. A boolean would let the second
   * caller return immediately with nothing useful; holding the in-flight promise lets every caller
   * await the *same* transaction. `already-running` is returned only to a caller that explicitly does
   * not want to wait — and there is exactly one transaction either way, which is the property that
   * matters: two concurrent runs would both read the same token, both fetch the same pages, and race
   * to publish two generations of the same rows.
   */
  let inFlight: Promise<SyncOutcome> | null = null;

  /** Whether the session that owns this orchestrator is still the signed-in one. */
  const live = (): boolean => deps.session.isValid();

  /**
   * Writes status **only while the session is live**.
   *
   * Every `updateSyncStatus` in this file goes through here, and that is what makes "an ended owner
   * emits no current-session UI update" a property of there being one gate rather than a rule at
   * eleven call sites. An ended run still returns its outcome to its own caller; what it may not do
   * is tell the shared channel — which the next signed-in user is reading — anything at all.
   */
  const report = (patch: Parameters<typeof updateSyncStatus>[0]): void => {
    if (live()) {
      updateSyncStatus(patch);
    }
  };

  const ended = (publishedBeforeEnd: boolean): SyncOutcome => ({
    kind: 'session-ended',
    publishedBeforeEnd,
    at: deps.now(),
  });

  /** An answer, a failure, or the news that the session ended while we waited for one. */
  type Answered =
    | { readonly kind: 'ok'; readonly data: QuranContentPayload }
    | { readonly kind: 'failed'; readonly failure: SyncFailure }
    | { readonly kind: 'cancelled' };

  /**
   * One outward request, guarded on both sides of the await.
   *
   * ── Why both sides, and why the second is the important one ───────────────
   * The check *before* stops a request that would carry an ended session's authority — the cheap and
   * obvious half. The check *after* is the one that closes the defect: an authenticated request that
   * was already in flight when the user signed out will still arrive, still be answered, and still
   * resolve here. Nothing can unsend it. What must not happen is that its answer is then used, and
   * this is where that is decided.
   *
   * The endpoint is never told to abort. See `content-sync.session.ts` for why a signal this feature
   * could not honour end-to-end would be a weaker guarantee wearing a stronger one's clothes.
   */
  const request = async (
    body: Parameters<QuranContentEndpoint['request']>[0],
  ): Promise<Answered> => {
    if (!live()) {
      return { kind: 'cancelled' };
    }
    const outcome = await deps.endpoint.request(body);
    if (!live()) {
      return { kind: 'cancelled' };
    }
    return outcome.kind === 'ok'
      ? { kind: 'ok', data: outcome.data }
      : { kind: 'failed', failure: toSyncFailure(outcome.failure) };
  };

  /**
   * Fetches a complete snapshot and validates it in full before returning anything.
   *
   * "In full" is the load-bearing part. A snapshot **replaces every local row**, so a partially
   * validated one is the most destructive thing this feed can apply — and a caller that received
   * half a snapshot and published it would have deleted whatever the other half would have contained.
   */
  const fetchSnapshot = async (
    group: 'recitations' | 'translations',
  ): Promise<
    | { readonly kind: 'ok'; readonly rows: readonly WireSyncRow[]; readonly sequence: number }
    | { readonly kind: 'failed'; readonly failure: SyncFailure }
    | { readonly kind: 'cancelled' }
  > => {
    const answer = await request({ operation: 'get_content_snapshot', resource_group: group });
    if (answer.kind !== 'ok') {
      return answer;
    }
    const payload = answer.data;
    if (payload.operation !== 'get_content_snapshot') {
      return { kind: 'failed', failure: 'invalid-response' };
    }
    const expectedId = group === 'recitations' ? SUDAIS_RESOURCE_ID : TRANSLATION_RESOURCE_ID;
    /*
      The group and id are checked against what was *asked for*, not merely read. A snapshot answering
      for another resource would replace one resource's rows with another's — and the server already
      refuses that, so seeing it here means something between the two is wrong and nothing should be
      published on the strength of it.
    */
    if (payload.resourceGroup !== group || payload.resourceId !== expectedId) {
      return { kind: 'failed', failure: 'invalid-response' };
    }
    if (payload.rows.some((row) => row.group !== group)) {
      return { kind: 'failed', failure: 'invalid-response' };
    }
    return { kind: 'ok', rows: payload.rows, sequence: payload.syncSequence };
  };

  /**
   * What a staging step reports back.
   *
   * `cancelled` is its own member rather than the `SyncFailure` of the same name, and the distinction
   * is load-bearing: a `SyncFailure` is recorded against the health record and advances the backoff,
   * and an abandoned run is not something the *device* should be penalised for. Sharing the spelling
   * would have made the two indistinguishable at the call site.
   */
  type Stage =
    | { readonly kind: 'ok' }
    | { readonly kind: 'failed'; readonly failure: SyncFailure }
    | { readonly kind: 'cancelled' };

  const stageTranslationSnapshot = async (
    staged: Staged,
    at: number,
    previous: ActiveGeneration | null,
  ): Promise<Stage> => {
    const snapshot = await fetchSnapshot('translations');
    if (snapshot.kind !== 'ok') {
      return snapshot;
    }
    const rows: TranslationRow[] = [];
    for (const row of snapshot.rows) {
      if (row.group !== 'translations') {
        return { kind: 'failed', failure: 'invalid-response' };
      }
      rows.push({
        verseKey: `${row.surah}:${row.ayah}`,
        surah: row.surah,
        ayah: row.ayah,
        text: row.text,
        resourceId: TRANSLATION_RESOURCE_ID,
        sequence: snapshot.sequence,
        refreshedAt: at,
      });
    }
    /*
      Attribution is preserved across the replacement rather than dropped. The snapshot carries rows,
      not a translator credit, and a screen that cannot name the translator must not render the
      translation — so replacing the rows while discarding the credit would take a lawful offline
      translation and make it unshowable.
    */
    staged.translations = { attribution: previous?.translations.attribution ?? null, rows };
    return { kind: 'ok' };
  };

  const stageRecitationSnapshot = async (
    staged: Staged,
    at: number,
    how: 'mutation' | 'snapshot',
  ): Promise<Stage> => {
    const snapshot = await fetchSnapshot('recitations');
    if (snapshot.kind !== 'ok') {
      return snapshot;
    }
    const rows: RecitationRow[] = [];
    for (const row of snapshot.rows) {
      if (row.group !== 'recitations') {
        return { kind: 'failed', failure: 'invalid-response' };
      }
      rows.push({
        verseKey: `${row.surah}:${row.ayah}`,
        resourceId: SUDAIS_RESOURCE_ID,
        surah: row.surah,
        ayah: row.ayah,
        durationSeconds: row.durationSeconds ?? null,
        bytes: row.bytes ?? null,
        sequence: snapshot.sequence,
        refreshedAt: at,
      });
    }
    staged.recitations = { rows };
    /*
      Recorded as *how it was reached*, and the distinction is a licence one rather than an
      engineering one. `snapshot` is assumption A1 — provisional, pending Quran Foundation's written
      confirmation — and it must never be reported as an observed mutation.
    */
    staged.recitationReconciliation = how;
    return { kind: 'ok' };
  };

  const runTransaction = async (force: boolean): Promise<SyncOutcome> => {
    const at = deps.now();

    /*
      Checkpoint 1, before anything at all. A run whose session ended between being scheduled and
      being started reads no storage, asks the platform nothing and contacts nobody.
    */
    if (!live()) {
      return ended(false);
    }

    const connectivity = await deps.connectivity.current();
    if (!live()) {
      return ended(false);
    }
    if (!canSync(connectivity)) {
      report({
        status: connectivity.isConnected ? 'waiting-for-connectivity' : 'offline',
        isRunning: false,
      });
      /*
        Not a failure worth recording against the checkpoint. Being offline is the expected state for
        a device that is offline, and writing a failure for it would make an ordinary aeroplane
        journey look like a broken integration.
      */
      return { kind: 'failed', failure: 'offline' };
    }

    /*
      Every clock is read from the **active generation**, not from a side record. The token, the
      sequence, the feed timestamp and the audio reconciliation all belong to the publication that
      produced them, so a device either has all four or none — never a token from one run beside rows
      from another.

      `checkpoint` is still read, and it is used for one thing only: failure and backoff state. It
      does not supply the token and cannot advance one.
    */
    const previous = await readActiveGeneration();
    const health = await readSyncHealth();

    /*
      Backoff and the minimum gap, checked before anything else costs a request. This is what stops a
      reconnect loop: a device flapping between networks fires a trigger per event, and without this
      each one would start a run against a server that is still refusing.

      A manual check may bypass "not due" — it may not bypass this, because a user pressing a button
      repeatedly is exactly the loop it exists to damp.
    */
    if (!mayAttempt(health, at)) {
      const sinceFailure = health.failedAt === null ? Infinity : at - health.failedAt;
      const sinceAttempt = health.lastAttemptedAt === null ? Infinity : at - health.lastAttemptedAt;
      return {
        kind: 'throttled',
        retryAfterMs: Math.max(
          0,
          Math.max(backoffDelayMs(health) - sinceFailure, MIN_ATTEMPT_INTERVAL_MS - sinceAttempt),
        ),
      };
    }
    await recordSyncAttempt(at);

    const elapsedFeed = previous === null ? null : at - previous.manifest.createdAt;
    const elapsedAudio = previous === null ? null : at - previous.manifest.recitation.lastCheckedAt;
    /* A clock that moved backwards is treated as due rather than as fresh; failing toward a check. */
    const feedDue = elapsedFeed === null || elapsedFeed < 0 || elapsedFeed >= SYNC_INTERVAL_MS;
    const audioDue =
      elapsedAudio === null || elapsedAudio < 0 || elapsedAudio >= RECITATION_CHECK_INTERVAL_MS;
    if (!force && !feedDue && !audioDue && previous !== null) {
      report({
        status: previous.manifest.recitation.mutationEverObserved
          ? 'current'
          : 'provisional-snapshot-reconciliation',
        lastPublishedAt: previous.manifest.createdAt,
        lastRecitationCheckAt: previous.manifest.recitation.lastCheckedAt,
        recitationMutationObserved: previous.manifest.recitation.mutationEverObserved,
        isRunning: false,
      });
      return { kind: 'not-due' };
    }

    /* No published generation means no token, which is exactly what a bootstrap is. */
    const bootstrapped = previous === null;
    report({ status: 'checking', isRunning: true });
    const staged: Staged = {
      translations: null,
      recitations: null,
      recitationMutationObserved: false,
      recitationReconciliation: 'none',
    };

    const fail = async (failure: SyncFailure): Promise<SyncOutcome> => {
      await recordSyncFailure(failure, deps.now());
      /*
        A failed run publishes nothing, so it emits **no revision** — only a status. A revision means
        "there is new content to resolve", and there is not.
      */
      report({ status: 'failed-retryable', lastFailure: failure, isRunning: false });
      return { kind: 'failed', failure };
    };

    // ── Steps 3 and 4: every page, then validate ────────────────────────────
    const mutations: WireMutation[] = [];
    let cursor: string | null = null;
    let finalToken: string | null = null;
    let syncedUntil = previous?.manifest.feed.syncedUntilSequence ?? 0;
    let pages = 0;

    for (;;) {
      pages += 1;
      if (pages > MAX_PAGES) {
        /* A feed that never ends. Refusing is right: the alternative is an unbounded loop. */
        return await fail('invalid-response');
      }
      const answer = await request({
        operation: 'sync_content_resources',
        ...(previous === null ? {} : { sync_token: previous.manifest.feed.syncToken }),
        ...(cursor === null ? {} : { cursor }),
      });
      if (answer.kind === 'cancelled') {
        /*
          Checkpoint 2. The page may well have arrived — the request was in flight when the session
          ended and nothing could recall it — and it is discarded unread. Nothing is staged, no token
          is carried forward, and no failure is recorded: the run was abandoned, not broken, and
          charging the device a backoff step for it would punish the next user for the last one's
          sign-out.
        */
        return ended(false);
      }
      if (answer.kind === 'failed') {
        /*
          A refused token clears through the documented `stale-token` path in the checkpoint store and
          nowhere else. There is no branch here that catches a failed incremental run and retries it
          as a bootstrap — a silent fallback would re-download every resource and, worse, would hide
          a token problem behind a full refresh that looks like success.
        */
        return await fail(answer.failure);
      }
      const page = answer.data;
      if (page.operation !== 'sync_content_resources') {
        return await fail('invalid-response');
      }
      if (page.resources !== CANONICAL_SYNC_FILTER) {
        /* A page answering for a different scope. The token would be bound to the wrong filter. */
        return await fail('invalid-response');
      }
      mutations.push(...page.mutations);
      syncedUntil = Math.max(syncedUntil, page.syncUntilSequence);

      if (page.hasMore) {
        if (page.nextCursor === null) {
          return await fail('invalid-response');
        }
        cursor = page.nextCursor;
        continue;
      }
      finalToken = page.nextSyncToken;
      break;
    }

    if (finalToken === null || finalToken.length === 0) {
      /* The run ended with nothing to commit. Without a token the next run cannot be incremental. */
      return await fail('invalid-response');
    }

    // ── Step 5: the snapshots each mutation requires ────────────────────────
    const translationMutations = mutations.filter(
      (mutation) => mutation.resourceGroup === 'translations',
    );
    const recitationMutations = mutations.filter(
      (mutation) => mutation.resourceGroup === 'recitations',
    );
    /* Set from the wire and from nowhere else. This is the flag no code path may set optimistically. */
    staged.recitationMutationObserved = recitationMutations.length > 0;

    const needsFullSnapshot = (list: readonly WireMutation[]): boolean =>
      list.some(
        (mutation) =>
          mutation.snapshotRequired ||
          mutation.type === 'RESOURCE_CREATE' ||
          mutation.type === 'RESOURCE_INVALIDATE',
      );

    if (needsFullSnapshot(translationMutations)) {
      const stage = await stageTranslationSnapshot(staged, at, previous);
      if (stage.kind === 'cancelled') {
        return ended(false);
      }
      if (stage.kind === 'failed') {
        return await fail(stage.failure);
      }
    }

    if (staged.recitationMutationObserved) {
      /* A real mutation. The documented path, and the only one that may be called `mutation`. */
      const stage = await stageRecitationSnapshot(staged, at, 'mutation');
      if (stage.kind === 'cancelled') {
        return ended(false);
      }
      if (stage.kind === 'failed') {
        return await fail(stage.failure);
      }
    } else if (audioDue || force) {
      /*
        ── Assumption A1, and the only place it is acted on ─────────────────
        No recitation mutation arrived — as none ever has — and the seven-connected-day audio check is
        due. The approved snapshot is re-fetched and reconciled against what is held locally. This is
        provisional and pending Quran Foundation's written confirmation; it is recorded as `snapshot`
        so no reader can mistake it for a mutation that was observed.
      */
      const stage = await stageRecitationSnapshot(staged, at, 'snapshot');
      if (stage.kind === 'cancelled') {
        return ended(false);
      }
      if (stage.kind === 'failed') {
        return await fail(stage.failure);
      }
    }

    // ── Step 6: one generation, published by one pointer write ─────────────
    /*
      ── Why this is a single act and the previous version was not ───────────
      This used to be four sequential durable writes: translations, recitations, the audio clock,
      then the token. A process death or a failed write between any two of them left the device
      holding one resource from this run beside another from the last, acknowledged by a token that
      covered neither. Deferring the writes to the end of a function made the window smaller; it did
      not remove it, and the comment that claimed otherwise was wrong.

      Everything is now written into a fresh private directory, reopened, validated in full, and made
      visible by **one** small pointer write. Every resource, the reconciliation metadata and the
      token that acknowledges them are in that directory together, so:

        • a crash before the pointer write leaves the previous generation active and whole;
        • a crash after it leaves the new generation active and whole;
        • there is no third state, because nothing reads anything but the pointer.

      Content the run did not refetch is carried forward from the previous generation rather than
      referenced across directories. A generation is self-contained by construction — a reader that
      holds its id can never assemble one resource from it and another from somewhere else.
    **/
    const translations =
      staged.translations ??
      (previous === null
        ? /*
             A bootstrap the vendor answered without a translation mutation. Empty is the honest
             state — nothing has been synchronised for that resource yet — and it is published
             rather than refused, because the token still has to belong to a generation. A later run
             that does receive the mutation replaces this generation whole.
           */
          { attribution: null, rows: [] }
        : { attribution: previous.translations.attribution, rows: previous.translations.rows });
    const recitations = staged.recitations ?? previous?.recitations ?? { rows: [] };

    const method =
      staged.recitationReconciliation === 'none'
        ? (previous?.manifest.recitation.method ?? 'none')
        : staged.recitationReconciliation;
    const lastCheckedAt =
      staged.recitations === null
        ? (previous?.manifest.recitation.lastCheckedAt ?? at)
        : deps.now();

    const draft: GenerationDraft = {
      /* Derived from the run rather than random, so a retry of the same run reuses the directory. */
      generationId: `gen-${at}-${checksumOf(finalToken)}`,
      createdAt: deps.now(),
      feed: {
        resources: CANONICAL_SYNC_FILTER,
        syncToken: finalToken,
        syncedUntilSequence: syncedUntil,
      },
      translations: { resourceId: TRANSLATION_RESOURCE_ID, ...translations },
      recitations: { resourceId: SUDAIS_RESOURCE_ID, rows: recitations.rows },
      recitation: {
        lastCheckedAt,
        method,
        mutationEverObserved:
          (previous?.manifest.recitation.mutationEverObserved ?? false) ||
          staged.recitationMutationObserved,
      },
    };

    /*
      Checkpoint 3, before a byte is staged. Everything up to this line was reading and arranging; the
      next call writes to the device.
    */
    if (!live()) {
      return ended(false);
    }

    /*
      Checkpoint 4 is inside `publishGeneration`, in the instruction immediately before the pointer
      write — the only place it can be, because that write is the publication. Passing the guard down
      rather than checking here is what makes the window between "checked" and "published" empty.
    */
    const published = await publishGeneration(draft, { isValid: live });
    if (published.kind === 'failed') {
      if (published.reason === 'cancelled') {
        /*
          The session ended somewhere between staging and the pointer. The previous generation is
          still active and still whole; the staged directory is unreferenced, and the ordinary sweeper
          removes it — it never touches the generation the pointer names, so this cannot cost the new
          user the content the old one had already synchronised.
        */
        await sweepGenerations();
        return ended(false);
      }
      /*
        Nothing became visible. The previous generation is still active, still whole, and still
        carries its own token — so the next run asks the same question rather than skipping ahead.
      **/
      return await fail('write-failed');
    }

    /*
      Only now is the previous generation eligible for removal, and a failure to remove it cannot
      invalidate the one just published — the sweeper never touches the generation the pointer names.
    **/
    await sweepGenerations();
    /* The failure state is cleared by a publication, never by an attempt. */
    await clearSyncFailure(deps.now());

    /*
      ── Checkpoint 5, and the one case that must not be smoothed over ────────
      The pointer has been written. The generation **is** active — that is a durable fact and no
      amount of session bookkeeping undoes it, so this does not pretend the publication did not
      happen; it reports the ordering on the outcome instead.

      What the ended owner may not do is speak to the shared status channel. A revision emitted here
      would arrive after the next user had signed in, telling their UI that *their* session had just
      published something. The generation is application content and stays readable; the announcement
      belongs to whoever is signed in, and that is no longer this run.
    */
    if (!live()) {
      return ended(true);
    }

    /*
      The one revision emission, and it is **after** the pointer write. Emitting before it would tell
      subscribers to re-read while the pointer still names the old generation: they would find nothing
      changed, and a later real publication carrying the same revision would be missed entirely.
    */
    publishRevision({
      publishedAt: draft.createdAt,
      lastRecitationCheckAt: draft.recitation.lastCheckedAt,
      recitationMutationObserved: draft.recitation.mutationEverObserved,
      /* A1 until Quran Foundation confirms: audio currency rests on a snapshot, not a mutation. */
      provisional: !draft.recitation.mutationEverObserved,
    });

    return {
      kind: 'synced',
      bootstrapped,
      pages,
      recitationMutationObserved: staged.recitationMutationObserved,
      recitationReconciliation: staged.recitationReconciliation,
      translationsReplaced: staged.translations !== null,
      at,
    };
  };

  return {
    isRunning: () => inFlight !== null,
    run: async (options) => {
      if (!live()) {
        /*
          An ended owner starts nothing, and — the part that matters for the next user — it never
          sets `inFlight`. A later caller asking this instance would otherwise be told
          `already-running` by a session that no longer exists.
        */
        return ended(false);
      }
      if (inFlight !== null) {
        return { kind: 'already-running' };
      }
      const running = runTransaction(options?.force === true).finally(() => {
        inFlight = null;
      });
      inFlight = running;
      return await running;
    },
  };
}

/**
 * Re-exported so a caller can read sync health without importing the store directly.
 *
 * There is deliberately nothing here that re-exports a token, a sequence or a success timestamp:
 * those come from the active generation and there is no second route to them.
 */
export { type SyncHealth };
