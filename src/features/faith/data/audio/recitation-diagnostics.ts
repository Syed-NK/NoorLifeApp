/**
 * A privacy-safe trace of what the recitation transport did, for diagnosing playback on a device.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * Playback failures on the release build were nondeterministic — a queue that built but stayed
 * paused, a jump from the first ayah to the last in three seconds, a queue that never built at all.
 * None of those is reachable in Jest, and none is diagnosable from a screenshot: the question is
 * always *what happened in what order*, and the answer lives on the device.
 *
 * ── What may be recorded, and what may never be ─────────────────────────────
 * The field list below is exhaustive and closed. It carries **identifiers and counts only**:
 *
 *   • a session/generation number
 *   • a reciter resource id, a surah number, an ayah number, a track index
 *   • how many tracks are queued, and the ayah range prepared
 *   • a command name, an event name, a phase name
 *   • an error code from a closed enum
 *
 * It may never carry a URL, a filesystem path, a token, a header, Qur'anic text, a translation, a
 * coordinate or anything derived from them. There is no `message` field and no `unknown` field, so
 * there is nowhere for one to be added by accident — a future edit that wants to log a URL has to
 * change this type first, which is exactly the review this boundary exists to force.
 *
 * `quran-audio-architecture-scan.test.ts` asserts that nothing on the audio path logs directly, so
 * this is the only route to a device log and every entry passes through the shape below.
 */

/** The one enum an entry may carry as a reason. Closed, and none of its members is free text. */
export type RecitationErrorCode =
  | 'no-recitations'
  | 'no-local-audio'
  /** The verse is not on this device. Playback stops rather than streaming or skipping. */
  | 'not-downloaded'
  | 'reciter-mismatch'
  | 'build-failed'
  | 'prepare-failed'
  | 'readiness-timeout'
  | 'stale-generation'
  | 'index-out-of-range'
  | 'duplicate-event';

export type RecitationTrace = {
  /** Monotonic milliseconds since the app started, for measuring intervals. */
  readonly at: number;
  /**
   * The playback session this belongs to, where one is meaningful.
   *
   * Optional since playback became local-only. The field existed to fence asynchronous continuations
   * — a preparation for Al-Baqarah resolving after the reader had moved to Al-Fatihah — and there is
   * no longer any asynchronous work on this path for a stale result to arrive from. It is kept for
   * the entries that still carry one rather than removed, so an older trace stays readable.
   */
  readonly generation?: number;
  readonly phase: string;
  /** What happened: an intent, a command issued, an event received, or a refusal. */
  readonly kind: 'intent' | 'command' | 'event' | 'phase' | 'refused';
  readonly name: string;
  readonly reciterId?: string;
  readonly surah?: number;
  readonly ayah?: number;
  readonly index?: number;
  readonly tracks?: number;
  /** The contiguous ayah span prepared, as two numbers. */
  readonly from?: number;
  readonly to?: number;
  readonly code?: RecitationErrorCode;
  /** Playback status flags, as booleans only. */
  readonly playing?: boolean;
  readonly loaded?: boolean;
  readonly buffering?: boolean;
};

/**
 * The last entries, in order.
 *
 * Bounded so a long listening session cannot grow it without limit. Read by tests and by the
 * measurement pass; never rendered.
 */
const MAX_ENTRIES = 400;
let entries: RecitationTrace[] = [];

export function recordRecitation(
  entry: Omit<RecitationTrace, 'at'> & { readonly at?: number },
): void {
  const complete: RecitationTrace = { ...entry, at: entry.at ?? Math.round(performance.now()) };
  entries.push(complete);
  if (entries.length > MAX_ENTRIES) {
    entries = entries.slice(-MAX_ENTRIES);
  }
}

export function recitationTrace(): readonly RecitationTrace[] {
  return entries;
}

export function clearRecitationTrace(): void {
  entries = [];
}

/**
 * The trace as one short line, for a failure message or a measurement report.
 *
 * ── Why this exists at all ──────────────────────────────────────────────────
 * Nothing on this path prints. The JavaScript console is not attached on an Android **release** build —
 * so a printing path would have been dead weight that the
 * architecture scan correctly refuses to allow near a signed audio URL. The ring buffer is read by
 * tests and by the measurement pass; this renders it as one line for a failure message.
 */
export function compactRecitationTrace(limit = 14): string {
  return entries
    .slice(-limit)
    .map((entry) => {
      const parts = [entry.name];
      if (entry.index !== undefined) parts.push(`i${entry.index}`);
      if (entry.ayah !== undefined) parts.push(`a${entry.ayah}`);
      if (entry.tracks !== undefined) parts.push(`n${entry.tracks}`);
      if (entry.from !== undefined) parts.push(`${entry.from}-${entry.to}`);
      if (entry.playing !== undefined) parts.push(entry.playing ? 'P' : 'p');
      if (entry.loaded !== undefined) parts.push(entry.loaded ? 'L' : 'l');
      if (entry.code !== undefined) parts.push(`!${entry.code}`);
      return entry.generation === undefined
        ? parts.join('.')
        : `${entry.generation}/${parts.join('.')}`;
    })
    .join(' ');
}

/**
 * The measured interval between one track's last activity and the next track's first playing report.
 *
 * ── What this measures, and what it does not ────────────────────────────────
 * It is the **application-visible** transition: from the last status of track N to the first
 * positive playing status of track N+1. It cannot see silence encoded in the vendor's own audio, and
 * it is not a PCM measurement — it is the window in which this app could have introduced a delay.
 * A small number here is evidence that NoorLife added nothing, not proof that nothing was audible.
 */
export function measuredTransitions(
  trace: readonly RecitationTrace[] = entries,
): readonly { readonly fromIndex: number; readonly toIndex: number; readonly ms: number }[] {
  const measured: { fromIndex: number; toIndex: number; ms: number }[] = [];
  for (let position = 0; position < trace.length; position += 1) {
    const change = trace[position];
    if (change?.kind !== 'event' || change.name !== 'trackChanged') {
      continue;
    }
    const playing = trace
      .slice(position + 1)
      .find((entry) => entry.kind === 'event' && entry.name === 'status' && entry.playing === true);
    if (playing === undefined) {
      continue;
    }
    measured.push({
      fromIndex: (change.index ?? 0) - 1,
      toIndex: change.index ?? 0,
      ms: playing.at - change.at,
    });
  }
  return measured;
}
