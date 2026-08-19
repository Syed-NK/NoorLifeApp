import { MAX_SURAH } from '../../storage/faith-arabic-rows';

/**
 * A **Quran selection** — one ayah, or a contiguous range, that the user chose for themselves.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── What this is, and the thing it is careful not to be ────────────────────
 * It is a *reference*. A surah number, a first ayah, a last ayah, and the user's own decisions about
 * it. It is **not** a dhikr, it is not a supplication, and it carries no claim that reciting it is
 * recommended, prescribed, rewarded or Sunnah. NoorLife has no standing to make any of those claims
 * and this type has no field in which one could be written down.
 *
 * That distinction is why this exists alongside `CuratedDhikrReference` rather than replacing it. A
 * curated entry is a *reviewed* claim — somebody qualified said this reference is appropriate as
 * dhikr, and their name and the date are attached. A selection is the user pointing at a verse. The
 * two are displayed differently, labelled differently, and never merged into one list, because a
 * private choice presented under a heading NoorLife vouches for would be the exact failure the five
 * removed dhikr presets were removed for.
 *
 * ── Why the identity is derived from the reference ─────────────────────────
 * `q.2.255.255` is the id of ayah 2:255, on every device, forever. Three consequences, all wanted:
 *
 *   • **Saving the same verse twice is impossible.** There is one record per reference, so a user
 *     who saves a verse again finds the one they already had, with its favourite state intact.
 *   • **The id survives a reinstall and a clock change.** A time-derived id would not, and the
 *     Tasbih counter is keyed on it — a counter whose identity moved would be a lost count.
 *   • **The id contains no user text.** A label is the user's words; the address it lives at is not.
 *
 * ── Why a range is two endpoints and nothing else ──────────────────────────
 * There is nowhere to express a selection of non-adjacent verses, so one cannot be built. That is
 * the *preserve original context* requirement made structural rather than remembered: a hand-picked
 * set of verses assembled into a "dua" is an editorial act, and this type refuses to hold one.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * The longest contiguous range a selection may cover.
 *
 * A bound rather than none, for two reasons that point the same way. A selection is shown in full on
 * the Tasbih control card and in the Duas list, and forty verses there is not a preview but a reader
 * with no chrome. And a "selection" that can be an entire surah is a way of assembling a personal
 * mushaf inside user storage by another name — which the retained generation already serves properly,
 * in the Reader, where it belongs.
 *
 * Ten covers the passages people actually keep for repetition with room above them. It is a product
 * limit, not a religious one, and it is stated as such wherever the user meets it.
 */
export const MAX_SELECTION_AYAT = 10;

/** The prefix every selection id — and every Tasbih counter id derived from one — carries. */
export const SELECTION_ID_PREFIX = 'q.';

/** A reference to one ayah or one contiguous range. The whole of what may be pointed at. */
export type QuranSelectionRef = {
  readonly surah: number;
  readonly startAyah: number;
  /** Inclusive. Equal to `startAyah` for a single verse. */
  readonly endAyah: number;
};

/**
 * A selection as it is stored: a reference, plus the user's own state about it.
 *
 * ── Every field here is a number, a boolean, or the user's own words ───────
 * There is no `arabic`, no `translation`, no `transliteration`, no NoorLife-supplied `title` and no
 * `translator`. Scripture is resolved from the retained generation at render time and is never
 * copied here — see `retained-selection.resolver.ts`. `sanitiseSelection` enforces that by
 * construction rather than by review: it rebuilds each record from the fields named in
 * `SELECTION_FIELDS`, so a field arriving from anywhere else cannot round-trip through storage.
 */
export type QuranSelection = QuranSelectionRef & {
  /** Derived from the reference. Stable, collision-free, and free of the user's words. */
  readonly id: string;
  /**
   * The user's own note about why they saved it, or `null`.
   *
   * Their words, on this device. Rendered as written and credited to nobody — the same rule a
   * personal counter label follows, and for the same reason.
   */
  readonly label: string | null;
  readonly favourite: boolean;
  /** Epoch milliseconds. When the user saved it. */
  readonly createdAt: number;
  /** Epoch milliseconds of the last time it was sent to Tasbih or opened. `null` until then. */
  readonly lastUsedAt: number | null;
};

/** How long a user's own note on a selection may be. Bounded so a label cannot become a document. */
export const MAX_SELECTION_LABEL_LENGTH = 60;

/** The id a reference resolves to. Pure, total, and the only place the format is written down. */
export function selectionIdFor(ref: QuranSelectionRef): string {
  return `${SELECTION_ID_PREFIX}${ref.surah}.${ref.startAyah}.${ref.endAyah}`;
}

/** Whether a Tasbih counter id names a Quran selection rather than a personal counter. */
export function isSelectionCounterId(counterId: string): boolean {
  return counterId.startsWith(SELECTION_ID_PREFIX);
}

/**
 * Why a proposed range may not be saved.
 *
 * Named rather than boolean because the screen says something different for each, and "that is not a
 * valid range" is not a sentence anybody can act on.
 */
export type SelectionRangeFault =
  | 'surah-out-of-range'
  | 'ayah-out-of-range'
  /** End before start. The interface swaps them first — see `orderRange` — so this needs a bypass. */
  | 'end-before-start'
  | 'too-long'
  /** The surah has fewer verses than that. Checked against the retained generation's own counts. */
  | 'ayah-beyond-surah';

export type SelectionRangeCheck =
  | { readonly ok: true; readonly ref: QuranSelectionRef }
  | { readonly ok: false; readonly fault: SelectionRangeFault };

/**
 * Puts two endpoints in order.
 *
 * A user who picked their range backwards has expressed a perfectly clear intention, and refusing it
 * to preserve an invariant the interface could maintain itself would be pedantry. So the ordering
 * happens here, once, and `end-before-start` stays reachable only for a caller that bypassed it —
 * which is why the fault still exists.
 */
export function orderRange(a: number, b: number): { readonly start: number; readonly end: number } {
  return a <= b ? { start: a, end: b } : { start: b, end: a };
}

/**
 * Whether a reference may become a selection.
 *
 * `ayahCount` is supplied by the caller from the retained generation rather than from a table here.
 * Hard-coding 114 verse counts would be scholarly content NoorLife has no licence and no standing to
 * author, and the same reasoning already governs `expectedVerseKeys` in `faith-arabic-rows.ts`.
 * Passing `null` means the count is unknown on this device, and the check then proves everything it
 * still can — the range stays bounded, and the resolver refuses a verse it cannot find.
 */
export function checkSelectionRange(
  ref: QuranSelectionRef,
  ayahCount: number | null,
): SelectionRangeCheck {
  if (!Number.isInteger(ref.surah) || ref.surah < 1 || ref.surah > MAX_SURAH) {
    return { ok: false, fault: 'surah-out-of-range' };
  }
  if (
    !Number.isInteger(ref.startAyah) ||
    !Number.isInteger(ref.endAyah) ||
    ref.startAyah < 1 ||
    ref.endAyah < 1
  ) {
    return { ok: false, fault: 'ayah-out-of-range' };
  }
  if (ref.endAyah < ref.startAyah) {
    return { ok: false, fault: 'end-before-start' };
  }
  if (ref.endAyah - ref.startAyah + 1 > MAX_SELECTION_AYAT) {
    return { ok: false, fault: 'too-long' };
  }
  if (ayahCount !== null && ref.endAyah > ayahCount) {
    return { ok: false, fault: 'ayah-beyond-surah' };
  }
  return { ok: true, ref: { surah: ref.surah, startAyah: ref.startAyah, endAyah: ref.endAyah } };
}

/** What a fault means, in the user's terms. Exhaustive, so a new fault is a compile error. */
export function selectionFaultMessage(fault: SelectionRangeFault): string {
  switch (fault) {
    case 'surah-out-of-range':
      return 'The Qur’an has 114 surahs.';
    case 'ayah-out-of-range':
      return 'Choose a verse number of one or more.';
    case 'end-before-start':
      return 'The last verse comes before the first.';
    case 'too-long':
      return `A selection can cover up to ${MAX_SELECTION_AYAT} verses. Longer passages belong in the Reader.`;
    case 'ayah-beyond-surah':
      return 'That verse is past the end of this surah.';
  }
}

/** The verse keys a reference covers, in order — the identity every resolved verse is matched on. */
export function selectionVerseKeys(ref: QuranSelectionRef): readonly string[] {
  const keys: string[] = [];
  for (let ayah = ref.startAyah; ayah <= ref.endAyah; ayah += 1) {
    keys.push(`${ref.surah}:${ayah}`);
  }
  return keys;
}

/** `2:255`, or `59:22-24` for a range. Shown with every selection, everywhere. */
export function selectionReferenceLabel(ref: QuranSelectionRef): string {
  return ref.startAyah === ref.endAyah
    ? `${ref.surah}:${ref.startAyah}`
    : `${ref.surah}:${ref.startAyah}-${ref.endAyah}`;
}

/** How many verses a reference covers. */
export function selectionLength(ref: QuranSelectionRef): number {
  return ref.endAyah - ref.startAyah + 1;
}

/**
 * The fields a stored selection may have. **The allow-list, and the only one.**
 *
 * Exported so the sanitiser and the test proving no scripture reaches user storage read one list
 * rather than two that could drift apart.
 */
export const SELECTION_FIELDS = [
  'id',
  'surah',
  'startAyah',
  'endAyah',
  'label',
  'favourite',
  'createdAt',
  'lastUsedAt',
] as const satisfies readonly (keyof QuranSelection)[];

/**
 * Trims a user's note to something storable, or `null`.
 *
 * Empty and whitespace-only both become `null` rather than an empty string, so "has no label" is one
 * value instead of two that render identically and compare differently.
 */
export function normaliseSelectionLabel(label: string | null | undefined): string | null {
  if (typeof label !== 'string') {
    return null;
  }
  const trimmed = label.trim().slice(0, MAX_SELECTION_LABEL_LENGTH);
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Rebuilds a record from the allow-list, or rejects it.
 *
 * ── Why rebuilt rather than validated ──────────────────────────────────────
 * A validator answers "is this acceptable?" and hands back the object it was given, extra fields
 * included. This answers "what of this is storable?" and constructs a new object from that answer,
 * so an `arabic` or `translation` field that reached a caller — from a resolved selection passed to
 * the wrong function, from a future refactor, from a blob written by a build that does not exist yet
 * — is not rejected with a warning nobody reads. It is simply not copied, and there is no code path
 * on which it could be.
 *
 * The id is recomputed from the reference rather than trusted, so a stored record whose id and
 * reference disagree resolves to the reference — the thing that actually names scripture.
 */
export function sanitiseSelection(value: unknown): QuranSelection | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const surah = record.surah;
  const startAyah = record.startAyah;
  const endAyah = record.endAyah;
  if (typeof surah !== 'number' || typeof startAyah !== 'number' || typeof endAyah !== 'number') {
    return null;
  }
  const ref: QuranSelectionRef = { surah, startAyah, endAyah };
  /*
    Re-checked on read with no ayah count: a record that is structurally impossible — surah 0, a
    range of forty — was either written by a bug or edited on the device, and either way the honest
    response is to drop it rather than render it.
  */
  const check = checkSelectionRange(ref, null);
  if (!check.ok) {
    return null;
  }
  const createdAt = record.createdAt;
  const lastUsedAt = record.lastUsedAt;
  return {
    id: selectionIdFor(check.ref),
    surah: check.ref.surah,
    startAyah: check.ref.startAyah,
    endAyah: check.ref.endAyah,
    label: normaliseSelectionLabel(typeof record.label === 'string' ? record.label : null),
    favourite: record.favourite === true,
    createdAt: typeof createdAt === 'number' && Number.isFinite(createdAt) ? createdAt : 0,
    lastUsedAt:
      typeof lastUsedAt === 'number' && Number.isFinite(lastUsedAt) && lastUsedAt > 0
        ? lastUsedAt
        : null,
  };
}
