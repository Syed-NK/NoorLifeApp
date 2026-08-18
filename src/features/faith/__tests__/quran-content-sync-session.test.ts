import type {
  QuranContentEndpoint,
  QuranContentPayload,
  QuranContentRequest,
  WireMutation,
  WireSyncRow,
} from '@features/faith/data/quran-foundation/quran-foundation.contract';
import {
  CANONICAL_SYNC_FILTER,
  createContentSyncOrchestrator,
  SUDAIS_RESOURCE_ID,
  SYNC_INTERVAL_MS,
  TOTAL_AYAH_COUNT,
  TRANSLATION_RESOURCE_ID,
} from '@features/faith/data/sync/content-sync.orchestrator';
import {
  createSyncSession,
  type SyncSession,
} from '@features/faith/data/sync/content-sync.session';
import { readSyncStatus, resetSyncStatus } from '@features/faith/data/sync/content-sync.revision';
import {
  clearSyncHealth,
  MIN_ATTEMPT_INTERVAL_MS,
  readSyncHealth,
} from '@features/faith/storage/faith-sync-checkpoint';
import * as generationStore from '@features/faith/storage/faith-sync-generation';
import {
  clearAllGenerations,
  publishGeneration,
  readActiveGeneration,
  readGenerationPointer,
} from '@features/faith/storage/faith-sync-generation';
import { mockFileSystem } from '@/../jest.setup';
import { createFakeConnectivity, WIFI_ONLINE } from '@/test-support/fake-connectivity-port';

/**
 * Session ownership — a transaction may not outlive the session that authorised it.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── The defect these cases exist for ───────────────────────────────────────
 * The coordinator detached its AppState and connectivity listeners when auth left `signed-in`, and
 * `resetContentSyncCoordinator` — documented as "called on sign-out" — had **zero production
 * callers**. Detaching a listener stops new triggers and does nothing to a run already under way, so
 * a transaction started under one session survived the sign-out and the next sign-in: free to fetch
 * a further page, stage a generation, flip the pointer, publish a revision and write current-session
 * status on an authority that no longer existed.
 *
 * ── Why every case here is driven from a real instant, not a stub ──────────
 * "Signs out while it is staging" is a claim about a moment *inside* `publishGeneration`, and a test
 * that invalidates the session before calling it proves a different, easier thing. So the sign-out
 * is fired from where it actually happens:
 *
 *   • **awaiting a request** — from a gate the endpoint is holding on
 *   • **as the last answer is produced** — from the endpoint, at the instant it returns
 *   • **mid-staging** — from the filesystem double, on the write of the first dataset
 *   • **immediately before the pointer** — on the write of the manifest, which is staged last
 *   • **after the pointer** — on `publishGeneration`'s return, the first instant at which the
 *     publication is a durable fact
 *
 * No sleeps and no timers: every wait is a promise the test itself resolves.
 *
 * ── The line the whole model turns on ──────────────────────────────────────
 * The pointer write. Before it, an ended session must leave the previous generation active and
 * publish nothing. After it, the publication is a durable fact and is reported as one — what the
 * ended owner still may not do is emit a revision or a status into the channel the *next* user is
 * reading.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const NOW = 1_700_000_000_000;

// ─────────────────────────────────────────────────────────────────────────────
// Wire shapes
// ─────────────────────────────────────────────────────────────────────────────

function translationRow(surah: number, ayah: number): WireSyncRow {
  return { group: 'translations', surah, ayah, text: `Verse ${surah}:${ayah}` };
}

function recitationRow(surah: number, ayah: number): WireSyncRow {
  return { group: 'recitations', surah, ayah, durationSeconds: 5, bytes: 40_000 };
}

function fullSnapshot(group: 'recitations' | 'translations'): QuranContentPayload {
  const rows: WireSyncRow[] = [];
  for (let index = 0; index < TOTAL_AYAH_COUNT; index += 1) {
    const surah = (index % 114) + 1;
    const ayah = Math.floor(index / 114) + 1;
    rows.push(group === 'translations' ? translationRow(surah, ayah) : recitationRow(surah, ayah));
  }
  return {
    operation: 'get_content_snapshot',
    resourceGroup: group,
    resourceId: group === 'recitations' ? SUDAIS_RESOURCE_ID : TRANSLATION_RESOURCE_ID,
    schemaVersion: 1,
    syncSequence: 4200,
    rows,
  };
}

function resourceCreate(group: 'recitations' | 'translations'): WireMutation {
  return {
    sequence: 1,
    type: 'RESOURCE_CREATE',
    resourceGroup: group,
    resourceId: group === 'recitations' ? SUDAIS_RESOURCE_ID : TRANSLATION_RESOURCE_ID,
    snapshotRequired: true,
  };
}

function page(
  over: { readonly token?: string; readonly mutations?: readonly WireMutation[] } = {},
) {
  return {
    operation: 'sync_content_resources',
    resources: CANONICAL_SYNC_FILTER,
    syncUntilSequence: 4200,
    hasMore: false,
    nextCursor: null,
    nextSyncToken: over.token ?? 'tok_final',
    mutations: over.mutations ?? [],
  } satisfies QuranContentPayload;
}

// ─────────────────────────────────────────────────────────────────────────────
// A gate, and an endpoint built from gates
// ─────────────────────────────────────────────────────────────────────────────

type Deferred = { readonly promise: Promise<void>; readonly resolve: () => void };

function deferred(): Deferred {
  /*
    Captured through a holder rather than assigned to a `let`: TypeScript cannot see an assignment
    made inside an executor and narrows the binding to `undefined` at every later use.
  */
  const holder: { resolve: () => void } = { resolve: () => {} };
  const promise = new Promise<void>((resolve) => {
    holder.resolve = () => {
      resolve();
    };
  });
  return { promise, resolve: () => holder.resolve() };
}

/**
 * An endpoint whose every answer the test releases by hand.
 *
 * `arrived(n)` resolves the instant the nth request is issued and `release(n)` lets it answer, so a
 * case can position a sign-out at an exact point in the transaction with no polling, no flush and no
 * timer. `onAnswer` fires after the payload is chosen and before it is returned — the moment the
 * data has been fetched and nothing has yet been done with it.
 */
function gatedEndpoint(
  answers: readonly QuranContentPayload[],
  hooks: { readonly onAnswer?: (index: number) => void } = {},
): QuranContentEndpoint & {
  readonly requests: QuranContentRequest[];
  readonly arrived: (index: number) => Promise<void>;
  readonly release: (index: number) => void;
  readonly releaseAll: () => void;
} {
  const requests: QuranContentRequest[] = [];
  const arrivals: Deferred[] = [];
  const gates: Deferred[] = [];
  /*
    `releaseAll` has to cover requests that have not been made yet. A transaction makes three, and a
    case that opens the gates before the first one is issued would otherwise hold the second and
    third shut forever — a hang, which is exactly the failure a "release everything" helper exists to
    prevent.
  */
  let openForever = false;

  const slot = (index: number): void => {
    while (arrivals.length <= index) {
      const gate = deferred();
      if (openForever) {
        gate.resolve();
      }
      arrivals.push(deferred());
      gates.push(gate);
    }
  };

  return {
    requests,
    arrived: (index) => {
      slot(index);
      return arrivals[index]?.promise ?? Promise.resolve();
    },
    release: (index) => {
      slot(index);
      gates[index]?.resolve();
    },
    releaseAll: () => {
      openForever = true;
      for (const gate of gates) {
        gate.resolve();
      }
    },
    request: async (body) => {
      const index = requests.length;
      slot(index);
      requests.push(body);
      arrivals[index]?.resolve();
      await gates[index]?.promise;
      const answer = answers[index];
      if (answer === undefined) {
        return { kind: 'failed', failure: 'invalid-response' };
      }
      hooks.onAnswer?.(index);
      return { kind: 'ok', data: answer, cacheMaxAgeMs: 0 };
    },
  };
}

/** An endpoint that answers immediately. For the session that is *not* the one under test. */
function immediateEndpoint(answers: readonly QuranContentPayload[]): QuranContentEndpoint & {
  readonly requests: QuranContentRequest[];
} {
  const requests: QuranContentRequest[] = [];
  return {
    requests,
    request: async (body) => {
      const index = requests.length;
      requests.push(body);
      const answer = answers[index];
      return await Promise.resolve(
        answer === undefined
          ? { kind: 'failed' as const, failure: 'invalid-response' as const }
          : { kind: 'ok' as const, data: answer, cacheMaxAgeMs: 0 },
      );
    },
  };
}

function orchestratorFor(
  session: SyncSession,
  endpoint: QuranContentEndpoint,
  now: () => number = () => NOW,
) {
  return createContentSyncOrchestrator({
    endpoint,
    connectivity: createFakeConnectivity(WIFI_ONLINE),
    now,
    session: { isValid: () => session.isValid() },
  });
}

/** The publisher catalogue, from which the resource-85 translator credit is resolved. */
function translationCatalogue(): QuranContentPayload {
  return {
    operation: 'list_translation_resources',
    editions: [
      { id: '85', language: 'english', name: 'M.A.S. Abdel Haleem', translator: 'Abdul Haleem' },
    ],
  };
}

/** * A bootstrap that asks for both snapshots: page, translations, recitations.
 *
 * Three requests rather than the minimum two, so "the last answer arrived" is distinguishable from
 * "the first one did" and a case can end the session at either.
 */
const BOOTSTRAP_ANSWERS: readonly QuranContentPayload[] = [
  page({ mutations: [resourceCreate('translations')] }),
  fullSnapshot('translations'),
  /* The translator credit is resolved between the two snapshots — see the orchestrator. */
  translationCatalogue(),
  fullSnapshot('recitations'),
];

/** Publishes a generation directly, so a case can start from a device that already has one. */
async function seedGeneration(token = 'tok_previous'): Promise<void> {
  const outcome = await publishGeneration({
    generationId: 'gen-previous',
    createdAt: NOW - SYNC_INTERVAL_MS - 1,
    feed: { resources: CANONICAL_SYNC_FILTER, syncToken: token, syncedUntilSequence: 10 },
    translations: {
      resourceId: TRANSLATION_RESOURCE_ID,
      attribution: {
        resourceId: TRANSLATION_RESOURCE_ID,
        name: 'The Clear Quran',
        translator: 'Dr. Mustafa Khattab',
      },
      rows: [
        {
          verseKey: '1:1',
          surah: 1,
          ayah: 1,
          text: 'previous generation',
          resourceId: TRANSLATION_RESOURCE_ID,
          sequence: 1,
          refreshedAt: NOW - SYNC_INTERVAL_MS - 1,
        },
      ],
    },
    recitations: {
      resourceId: SUDAIS_RESOURCE_ID,
      rows: [
        {
          verseKey: '1:1',
          resourceId: SUDAIS_RESOURCE_ID,
          surah: 1,
          ayah: 1,
          durationSeconds: 5,
          bytes: 40_000,
          sequence: 1,
          refreshedAt: NOW - SYNC_INTERVAL_MS - 1,
        },
      ],
    },
    recitation: {
      lastCheckedAt: NOW - SYNC_INTERVAL_MS - 1,
      method: 'snapshot',
      mutationEverObserved: false,
    },
  });
  if (outcome.kind !== 'published') {
    throw new Error('the seed generation did not publish');
  }
}

/** Every file the generation store currently holds. Proves staging happened, or did not. */
function generationFiles(): string[] {
  return mockFileSystem.uris().filter((uri) => uri.includes('quran-sync'));
}

beforeEach(async () => {
  mockFileSystem.reset();
  resetSyncStatus();
  await clearSyncHealth();
  await clearAllGenerations();
});

afterEach(() => {
  mockFileSystem.onWrite(null);
});

// ─────────────────────────────────────────────────────────────────────────────
// 1–2. Before the first request, and while the first one is in flight
// ─────────────────────────────────────────────────────────────────────────────

describe('a session that ends before the transaction gets anywhere', () => {
  it('sends no request at all when the session ended before the run started', async () => {
    const session = createSyncSession('user-a');
    const endpoint = gatedEndpoint(BOOTSTRAP_ANSWERS);
    const orchestrator = orchestratorFor(session, endpoint);

    session.invalidate();
    const outcome = await orchestrator.run();

    expect(outcome).toEqual({ kind: 'session-ended', publishedBeforeEnd: false, at: NOW });
    expect(endpoint.requests).toEqual([]);
    expect(await readGenerationPointer()).toBeNull();
    /* And nothing was even read: an ended run does not touch the health record either. */
    expect((await readSyncHealth()).lastAttemptedAt).toBeNull();
  });

  it('cannot publish when the session ends while page one is still awaited', async () => {
    const session = createSyncSession('user-a');
    const endpoint = gatedEndpoint(BOOTSTRAP_ANSWERS);
    const orchestrator = orchestratorFor(session, endpoint);

    const running = orchestrator.run();
    await endpoint.arrived(0);
    expect(orchestrator.isRunning()).toBe(true);

    session.invalidate();
    endpoint.release(0);

    const outcome = await running;
    expect(outcome.kind).toBe('session-ended');
    expect(outcome.kind === 'session-ended' && outcome.publishedBeforeEnd).toBe(false);
    /*
      The page arrived — nothing can unsend a request already in flight — and was discarded unread.
      No second request followed it, nothing was staged, and no pointer exists.
    */
    expect(endpoint.requests).toHaveLength(1);
    expect(generationFiles()).toEqual([]);
    expect(await readGenerationPointer()).toBeNull();
  });

  it('records no failure for an abandoned run', async () => {
    /*
      A sign-out is not a fault of the device or the vendor. Writing a failure here would advance the
      backoff and make the *next* user wait out a penalty earned by somebody else leaving.
    */
    const session = createSyncSession('user-a');
    const endpoint = gatedEndpoint(BOOTSTRAP_ANSWERS);
    const orchestrator = orchestratorFor(session, endpoint);

    const running = orchestrator.run();
    await endpoint.arrived(0);
    session.invalidate();
    endpoint.release(0);
    await running;

    const health = await readSyncHealth();
    expect(health.lastFailure).toBeNull();
    expect(health.consecutiveFailures).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. After the data is fetched, before anything is staged
// ─────────────────────────────────────────────────────────────────────────────

describe('a session that ends between the last answer and the first write', () => {
  it('stages no generation when the session ends as the final snapshot is produced', async () => {
    const session = createSyncSession('user-a');
    /* Fired from inside the endpoint, at the instant the third and final payload is handed back. */
    const endpoint = gatedEndpoint(BOOTSTRAP_ANSWERS, {
      onAnswer: (index) => {
        if (index === 2) {
          session.invalidate();
        }
      },
    });
    const orchestrator = orchestratorFor(session, endpoint);

    const running = orchestrator.run();
    endpoint.releaseAll();
    const outcome = await running;

    expect(outcome.kind).toBe('session-ended');
    expect(outcome.kind === 'session-ended' && outcome.publishedBeforeEnd).toBe(false);
    /* Every page and both snapshots were fetched, and not one byte of them reached the device. */
    expect(endpoint.requests).toHaveLength(3);
    expect(generationFiles()).toEqual([]);
    expect(await readGenerationPointer()).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4–5. Mid-staging, and the instruction before the pointer
// ─────────────────────────────────────────────────────────────────────────────

describe('a session that ends inside the publication', () => {
  it('leaves the pointer on the previous generation when it ends mid-staging', async () => {
    await seedGeneration();
    const session = createSyncSession('user-a');
    /* The first dataset written is `translations.json.part`; the manifest is still two writes away. */
    mockFileSystem.onWrite((uri) => {
      if (uri.endsWith('translations.json.part')) {
        session.invalidate();
      }
    });
    const endpoint = gatedEndpoint(BOOTSTRAP_ANSWERS);
    const orchestrator = orchestratorFor(session, endpoint);

    const running = orchestrator.run();
    endpoint.releaseAll();
    const outcome = await running;

    expect(outcome.kind).toBe('session-ended');
    expect(outcome.kind === 'session-ended' && outcome.publishedBeforeEnd).toBe(false);

    const pointer = await readGenerationPointer();
    expect(pointer?.generationId).toBe('gen-previous');
    const active = await readActiveGeneration();
    expect(active?.translations.rows[0]?.text).toBe('previous generation');
    expect(active?.manifest.feed.syncToken).toBe('tok_previous');
    /* The abandoned directory went through the ordinary sweeper, which never touches the active one. */
    expect(generationFiles().some((uri) => !uri.includes('gen-previous'))).toBe(false);
  });

  it('leaves the pointer on the previous generation when it ends one instruction before publication', async () => {
    await seedGeneration();
    const session = createSyncSession('user-a');
    /*
      The manifest is staged **last**, so its write is the final act before the generation is
      reopened, validated and published. Ending the session here is the narrowest window the
      transaction has, and it is the one the whole model is specified against.
    */
    mockFileSystem.onWrite((uri) => {
      if (uri.endsWith('generation.json.part')) {
        session.invalidate();
      }
    });
    const endpoint = gatedEndpoint(BOOTSTRAP_ANSWERS);
    const orchestrator = orchestratorFor(session, endpoint);

    const running = orchestrator.run();
    endpoint.releaseAll();
    const outcome = await running;

    expect(outcome.kind).toBe('session-ended');
    expect(outcome.kind === 'session-ended' && outcome.publishedBeforeEnd).toBe(false);
    expect((await readGenerationPointer())?.generationId).toBe('gen-previous');
    expect((await readActiveGeneration())?.manifest.feed.syncToken).toBe('tok_previous');
    /* No revision was announced, because nothing was published. */
    expect(readSyncStatus().revision).toBe(0);
  });

  it('reports the true ordering when the session ends after the pointer was written', async () => {
    /*
      The one case that must not be smoothed over. The pointer write is the publication; once it has
      happened, saying otherwise would be a lie about durable state. So the generation stays active
      and the outcome says so — while the ended owner still emits no revision and no status into the
      channel the next signed-in user is reading.
    */
    const session = createSyncSession('user-a');
    /*
      Hooked on `publishGeneration`'s **return**, which is the instruction immediately after the
      pointer write and the first observable moment at which the publication is a durable fact. The
      real implementation runs; only the instant after it is borrowed. Spying on the AsyncStorage
      write itself is not an option — the mock's `setItem` re-enters through the module object, so a
      spy on it recurses until the stack gives out.
    */
    const realPublish = generationStore.publishGeneration;
    const spy = jest
      .spyOn(generationStore, 'publishGeneration')
      .mockImplementation(async (draft, options) => {
        const outcome = await realPublish(draft, options);
        if (outcome.kind === 'published') {
          session.invalidate();
        }
        return outcome;
      });

    try {
      const endpoint = gatedEndpoint(BOOTSTRAP_ANSWERS);
      const orchestrator = orchestratorFor(session, endpoint);

      const running = orchestrator.run();
      endpoint.releaseAll();
      const outcome = await running;

      expect(outcome.kind).toBe('session-ended');
      expect(outcome.kind === 'session-ended' && outcome.publishedBeforeEnd).toBe(true);

      /* Published, and readable — it is application content, not the departed session's data. */
      const active = await readActiveGeneration();
      expect(active?.manifest.feed.syncToken).toBe('tok_final');
      expect(active?.translations.rows).toHaveLength(TOTAL_AYAH_COUNT);
      /*
        And silent from the moment the session ended. No revision was announced and no published
        status was written, so nothing tells the *next* signed-in user that their session just
        synchronised. The channel is left holding the last thing the live session legitimately said
        — `checking` — and the coordinator clears exactly that on sign-out; see
        `quran-content-sync-wiring.test.tsx`.
      */
      const model = readSyncStatus();
      expect(model.revision).toBe(0);
      expect(model.lastPublishedAt).toBeNull();
      expect(['current', 'integrity-reconciliation']).not.toContain(model.status);
    } finally {
      spy.mockRestore();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6–7. One user's abandoned run, and the next user's session
// ─────────────────────────────────────────────────────────────────────────────

describe('two users, one process', () => {
  it("releasing user A's blocked run cannot affect user B's published generation", async () => {
    const sessionA = createSyncSession('user-a');
    const blocked = gatedEndpoint(BOOTSTRAP_ANSWERS);
    const orchestratorA = orchestratorFor(sessionA, blocked);

    const runA = orchestratorA.run();
    await blocked.arrived(0);

    /* A signs out. B signs in with a fresh owner and a fresh orchestrator. */
    sessionA.invalidate();
    const sessionB = createSyncSession('user-b');
    const laterOn = NOW + MIN_ATTEMPT_INTERVAL_MS;
    const orchestratorB = orchestratorFor(
      sessionB,
      immediateEndpoint([page({ token: 'tok_b' }), fullSnapshot('recitations')]),
      () => laterOn,
    );

    const outcomeB = await orchestratorB.run();
    expect(outcomeB.kind).toBe('synced');
    expect((await readActiveGeneration())?.manifest.feed.syncToken).toBe('tok_b');
    const publishedByB = await readGenerationPointer();

    /* Now A's request finally answers. It must change nothing. */
    blocked.release(0);
    blocked.releaseAll();
    const outcomeA = await runA;

    expect(outcomeA.kind).toBe('session-ended');
    expect(outcomeA.kind === 'session-ended' && outcomeA.publishedBeforeEnd).toBe(false);
    expect(await readGenerationPointer()).toEqual(publishedByB);
    expect((await readActiveGeneration())?.manifest.feed.syncToken).toBe('tok_b');
    /* A stopped at its first checkpoint after the answer: it never asked for a snapshot. */
    expect(blocked.requests).toHaveLength(1);
  });

  it("does not tell user B that user A's transaction is already running", async () => {
    const sessionA = createSyncSession('user-a');
    const blocked = gatedEndpoint(BOOTSTRAP_ANSWERS);
    const orchestratorA = orchestratorFor(sessionA, blocked);

    const runA = orchestratorA.run();
    await blocked.arrived(0);
    expect(orchestratorA.isRunning()).toBe(true);

    sessionA.invalidate();

    /*
      B's orchestrator is a fresh instance, so it holds none of A's in-flight promise, retry state or
      single-flight guard. `already-running` is structurally unreachable across owners.
    */
    const sessionB = createSyncSession('user-b');
    const outcomeB = await orchestratorFor(
      sessionB,
      immediateEndpoint([page({ token: 'tok_b' }), fullSnapshot('recitations')]),
      () => NOW + MIN_ATTEMPT_INTERVAL_MS,
    ).run();
    expect(outcomeB.kind).toBe('synced');

    /* And A's own instance refuses rather than reporting its dead run as in flight. */
    expect((await orchestratorA.run()).kind).toBe('session-ended');

    blocked.releaseAll();
    expect((await runA).kind).toBe('session-ended');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 13. What survives a sign-out
// ─────────────────────────────────────────────────────────────────────────────

describe('what a sign-out leaves behind', () => {
  it('keeps the active generation readable after the session that published it ended', async () => {
    const session = createSyncSession('user-a');
    const orchestrator = orchestratorFor(
      session,
      immediateEndpoint([
        page({ mutations: [resourceCreate('translations')] }),
        fullSnapshot('translations'),
        translationCatalogue(),
        fullSnapshot('recitations'),
      ]),
    );
    expect((await orchestrator.run()).kind).toBe('synced');

    session.invalidate();

    /*
      The Qur'an, a licensed translation and a recitation index are application content, not the
      departed user's data. Deleting them on sign-out would make the next launch re-download eight
      mebibytes to arrive at exactly the same bytes.
    */
    const active = await readActiveGeneration();
    expect(active?.translations.rows).toHaveLength(TOTAL_AYAH_COUNT);
    expect(active?.recitations.rows).toHaveLength(TOTAL_AYAH_COUNT);
    expect(active?.manifest.feed.syncToken).toBe('tok_final');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 12. Nothing is written to a log, on any path
// ─────────────────────────────────────────────────────────────────────────────

describe('what the session path does not log', () => {
  it('writes nothing to the console on a successful run or an abandoned one', async () => {
    /*
      Asserted as *zero calls* rather than by inspecting arguments for forbidden substrings. A
      console call with safe arguments today is a console call somebody widens tomorrow, and the
      things that must never appear — a credential, a token, an endpoint URL, Qur'an or translation
      text, an audio URL, a page cursor, a coordinate, an email — are all one interpolation away from
      any logging statement that exists at all.
    */
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
      jest.spyOn(console, method).mockImplementation(() => undefined),
    );

    try {
      const first = createSyncSession('user-a');
      expect(
        (
          await orchestratorFor(
            first,
            immediateEndpoint([
              page({ mutations: [resourceCreate('translations')] }),
              fullSnapshot('translations'),
              translationCatalogue(),
              fullSnapshot('recitations'),
            ]),
          ).run()
        ).kind,
      ).toBe('synced');

      const second = createSyncSession('user-b');
      const blocked = gatedEndpoint(BOOTSTRAP_ANSWERS);
      /* Forced, because the generation the first run just published is not yet due for a check. */
      const running = orchestratorFor(second, blocked, () => NOW + MIN_ATTEMPT_INTERVAL_MS).run({
        force: true,
      });
      await blocked.arrived(0);
      second.invalidate();
      blocked.releaseAll();
      expect((await running).kind).toBe('session-ended');

      for (const spy of spies) {
        expect(spy).not.toHaveBeenCalled();
      }
    } finally {
      for (const spy of spies) {
        spy.mockRestore();
      }
    }
  });
});
