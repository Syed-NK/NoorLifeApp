import {
  AUDIO_BASE_URL,
  AUDIO_HOST_ALLOWLIST,
  CONTENT_SOURCE_NAME,
  MAX_AYAH,
  MAX_SURAH,
  MIN_AYAH,
  MIN_SURAH,
  type QuranPayload,
  SCRIPTURE_EDITION,
  type WireChapter,
  type WireEdition,
  type WirePagination,
  type WireRecitation,
  type WireReciter,
  type WireSource,
  type WireTranslation,
  type WireVerse,
} from './contract.ts';
import type { NormalizeReason, QuranQuery, TranslationAttribution } from './ports.ts';

/**
 * Upstream JSON → NoorLife's domain shapes.
 *
 * ── The one rule this module exists to hold ──────────────────────────────────
 * **Qur'anic Arabic is copied and nothing else.** `text_uthmani` is read, checked to be a non-empty
 * string, and assigned. There is no `.normalize()`, no `.trim()`, no `.replace()`, no NFC or NFD
 * pass, no whitespace collapse, no diacritic handling and no transliteration anywhere on that path —
 * `tests/normalize_test.ts` asserts byte equality against fixtures carrying superscript alif, small
 * high waw, madda and pause marks, every one of which a well-meaning "clean-up" would have altered.
 *
 * The transformation that *does* happen is confined to **translations**, is markup removal rather
 * than text normalisation, and is described where it is implemented.
 *
 * ── Why every reader returns `null` rather than throwing ─────────────────────
 * An upstream response is untrusted input. A `type Chapter = { … }` and a cast would compile and
 * check nothing, which is the standard way a "validated" boundary ends up unvalidated, and a thrown
 * error would carry whatever the runtime decided to put in its message — from a value that came from
 * a third party. `null` means "not a shape this contract recognises", the handler turns it into
 * `upstream_unavailable`, and nothing about the offending body survives the return.
 */

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function boundedInteger(value: unknown, min: number, max: number): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
    ? value
    : null;
}

/**
 * The scripture provenance stamped on every verse payload.
 *
 * A function rather than a constant so the object is fresh per response and cannot be mutated by one
 * caller into something another caller then serves. It identifies the vendor and the edition, which
 * is what "source metadata must identify Quran Foundation and the edition/resource" asks for.
 */
export function scriptureSource(): WireSource {
  return { name: CONTENT_SOURCE_NAME, edition: SCRIPTURE_EDITION, verified: true };
}

/**
 * `meta.translation_name` / `meta.author_name`, when a response carries them.
 *
 * ── Read defensively, because the specification does not promise them here ──
 * `QuranTranslationMeta` requires both fields, but it is referenced by exactly one path —
 * `/quran/translations/{id}` — and neither route this function reads declares a `meta` block at all.
 * So this is a *secondary* source: honoured where the vendor sends it, never depended on. Both
 * fields must be present and non-empty, because half a pair is not an attribution.
 */
export function readMetaAttribution(body: unknown): TranslationAttribution | null {
  const meta = asRecord(asRecord(body)?.meta);
  const title = nonEmptyString(meta?.translation_name);
  const translator = nonEmptyString(meta?.author_name);
  return title === null || translator === null ? null : { title, translator };
}

/**
 * The attribution hierarchy, resolved as a **pair from one source**.
 *
 * ── Why the sources are not mixed field by field ────────────────────────────
 * Taking a title from one place and a translator from another would produce a credit that no source
 * actually asserts — a Frankenstein attribution that looks authoritative precisely because both
 * halves are real. Each source is taken whole or not at all.
 *
 * The order, strongest first:
 *
 *   1. **The catalogue.** `/resources/translations`, keyed by the exact requested id, carrying the
 *      vendor's own `name` and `author_name`. It is the only source that gives a title *and* a
 *      translator as separate, correct fields.
 *   2. **Response `meta`.** Required where it appears, absent from these routes in the specification,
 *      honoured if the live API sends it anyway.
 *   3. **The entry label.** `resource_name` is one combined string — "Dr. Mustafa Khattab, the Clear
 *      Quran" — and splitting it into a title and a translator would be this function inventing the
 *      boundary. It is therefore used as the *edition title only*, and the credit line says less
 *      rather than naming a translator nobody asserted.
 *
 * `null` means none of the three produced anything, and the caller fails closed. An unattributed
 * rendering of the Qur'an is the one outcome this whole path exists to prevent.
 */
export function resolveTranslationSource(
  catalogue: TranslationAttribution | undefined,
  meta: TranslationAttribution | null,
  entryLabel: string | null,
): WireSource | null {
  const pair = catalogue ?? meta;
  if (pair !== undefined && pair !== null) {
    return {
      name: CONTENT_SOURCE_NAME,
      edition: pair.title,
      attribution: pair.translator,
      verified: true,
    };
  }
  if (entryLabel !== null) {
    return { name: CONTENT_SOURCE_NAME, edition: entryLabel, verified: true };
  }
  return null;
}

/**
 * `revelation_place` → the domain's two values.
 *
 * An unrecognised value is a **failure**, not a default. Where a surah was revealed is a fact about
 * scripture, and a mapping that fell back to `meccan` for anything it did not know would be this
 * function inventing one — quietly, for every future spelling the vendor introduces. The two accepted
 * spellings plus their common variants cover what the documentation shows; anything else fails the
 * whole response and gets looked at.
 */
export function toRevelation(value: unknown): 'meccan' | 'medinan' | null {
  if (typeof value !== 'string') {
    return null;
  }
  switch (value.toLowerCase()) {
    case 'makkah':
    case 'mecca':
    case 'meccan':
    case 'makki':
      return 'meccan';
    case 'madinah':
    case 'medina':
    case 'medinah':
    case 'medinan':
    case 'madani':
      return 'medinan';
    default:
      return null;
  }
}

function readChapter(raw: unknown): WireChapter | null {
  const chapter = asRecord(raw);
  if (chapter === null) {
    return null;
  }
  const number = boundedInteger(chapter.id, MIN_SURAH, MAX_SURAH);
  const name = nonEmptyString(chapter.name_simple);
  const arabicName = nonEmptyString(chapter.name_arabic);
  const ayahCount = boundedInteger(chapter.verses_count, MIN_AYAH, MAX_AYAH);
  const revelation = toRevelation(chapter.revelation_place);
  const meaning = nonEmptyString(asRecord(chapter.translated_name)?.name);

  if (
    number === null || name === null || arabicName === null || ayahCount === null ||
    revelation === null || meaning === null
  ) {
    return null;
  }
  /**
   * `name_arabic` is Arabic, and it is copied exactly like scripture is.
   *
   * It is a *name* rather than a verse, so the immutability rule does not formally reach it — but the
   * reason for the rule does. There is no transformation available here that would improve "الكهف"
   * and several that would damage it.
   */
  return { number, name, arabicName, meaning, ayahCount, revelation };
}

export function normalizeChapters(body: unknown): readonly WireChapter[] | null {
  const chapters = asRecord(body)?.chapters;
  if (!Array.isArray(chapters) || chapters.length === 0) {
    return null;
  }
  const mapped: WireChapter[] = [];
  for (const entry of chapters) {
    const chapter = readChapter(entry);
    if (chapter === null) {
      return null;
    }
    mapped.push(chapter);
  }
  return mapped;
}

export function normalizeChapter(body: unknown, expectedSurah: number): WireChapter | null {
  const chapter = readChapter(asRecord(body)?.chapter);
  if (chapter === null || chapter.number !== expectedSurah) {
    // A chapter other than the one asked for is a shape this contract does not recognise, not a
    // result to render — silently showing surah 3 for a request for surah 2 is worse than an error.
    return null;
  }
  return chapter;
}

/**
 * `verse_key` — the vendor's `surah:ayah` form — parsed and checked against the request.
 *
 * Read in preference to `chapter_id` and `verse_number` because it is the field the documentation
 * describes as the verse's identity, and cross-checked against the surah the caller asked for so a
 * response for the wrong chapter cannot be rendered as the right one.
 */
export function parseVerseKey(
  value: unknown,
  expectedSurah: number,
): { readonly surah: number; readonly ayah: number } | null {
  if (typeof value !== 'string') {
    return null;
  }
  const match = /^([0-9]{1,3}):([0-9]{1,3})$/.exec(value);
  if (match === null) {
    return null;
  }
  const surah = boundedInteger(Number(match[1]), MIN_SURAH, MAX_SURAH);
  const ayah = boundedInteger(Number(match[2]), MIN_AYAH, MAX_AYAH);
  if (surah === null || ayah === null || surah !== expectedSurah) {
    return null;
  }
  return { surah, ayah };
}

function readVerse(raw: unknown, expectedSurah: number): WireVerse | null {
  const verse = asRecord(raw);
  if (verse === null) {
    return null;
  }
  const key = parseVerseKey(verse.verse_key, expectedSurah);
  if (key === null) {
    return null;
  }
  const arabic = verse.text_uthmani;
  if (typeof arabic !== 'string' || arabic.length === 0) {
    /**
     * The Arabic is absent.
     *
     * This is a failure rather than a verse with an empty string, and the distinction is the whole
     * point: an ayah rendered as blank is a claim that the ayah is blank. It happens when `fields`
     * was not sent — the vendor omits Arabic by default — which is a defect in this function's own
     * request, and failing loudly is how it gets found.
     */
    return null;
  }
  // Copied. See the file note: no normalisation of any kind touches this string.
  return { surah: key.surah, ayah: key.ayah, arabic };
}

/**
 * The vendor's pagination object → an opaque cursor.
 *
 * `next_page` is documented as nullable, and `null` is the end of the surah. The cursor is the page
 * number as a decimal string because the client treats it as opaque — it hands back whatever it was
 * given — so the encoding is this function's business and can change without a client release.
 */
export function readPagination(raw: unknown): WirePagination {
  const pagination = asRecord(raw);
  const next = pagination?.next_page;
  const total = pagination?.total_records;
  return {
    nextCursor: typeof next === 'number' && Number.isInteger(next) && next > 0
      ? String(next)
      : null,
    ...(typeof total === 'number' && Number.isInteger(total) && total >= 0 ? { total } : {}),
  };
}

export function normalizeVerses(
  body: unknown,
  expectedSurah: number,
): { readonly verses: readonly WireVerse[]; readonly pagination: WirePagination } | null {
  const envelope = asRecord(body);
  if (envelope === null || !Array.isArray(envelope.verses)) {
    return null;
  }
  const verses: WireVerse[] = [];
  for (const entry of envelope.verses) {
    const verse = readVerse(entry, expectedSurah);
    if (verse === null) {
      return null;
    }
    verses.push(verse);
  }
  return { verses, pagination: readPagination(envelope.pagination) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Translations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Footnote markers, removed whole rather than unwrapped.
 *
 * The vendor's own schema says translation text "could have HTML tags for formatting and footnotes",
 * and the footnote form is `<sup foot_note="123">1</sup>`. Stripping only the tags would leave a bare
 * `1` sitting in the middle of a sentence — a digit the reader would take as part of the translation.
 * This function does not fetch footnotes, so the honest treatment of a reference to one is to drop
 * the reference rather than to leave a dangling number.
 */
const FOOTNOTE_BLOCK = /<sup\b[^>]*>[\s\S]*?<\/sup>/gi;

/** Any remaining tag. Formatting markup only — `<i>`, `<b>`, `<br>` and their closers. */
const HTML_TAG = /<\/?[a-z][^>]*>/gi;

/** The named and numeric references a translation body realistically carries. */
const ENTITIES: Readonly<Record<string, string>> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
  '&#39;': "'",
  '&nbsp;': ' ',
};

/**
 * Translation text, with markup removed.
 *
 * ── Why this is not a violation of the immutability rule ─────────────────────
 * The rule is about **Qur'anic Arabic**, and this function never sees any: it is applied to
 * `translation.text` and to nothing else, and `normalizeVerses` above has no call to it. A
 * translation is an attributed human rendering delivered as an HTML fragment, and NoorLife renders it
 * into a React Native `Text`, which has no markup layer — so leaving the tags in would put a literal
 * `<i>` on the screen. Removing them is the presentation step the vendor's own format requires.
 *
 * ── What it deliberately does not do ─────────────────────────────────────────
 * It does not collapse internal whitespace, does not change case, does not normalise Unicode, does
 * not re-punctuate and does not truncate. The **words** are the translator's and come through
 * unaltered; only markup and the surrounding whitespace it leaves behind are touched.
 */
export function stripTranslationMarkup(value: string): string {
  const withoutMarkup = value.replace(FOOTNOTE_BLOCK, '').replace(HTML_TAG, '');
  const decoded = withoutMarkup.replace(
    /&(?:amp|lt|gt|quot|apos|nbsp|#39);/gi,
    (entity) => ENTITIES[entity.toLowerCase()] ?? entity,
  );
  return decoded.trim();
}

type TranslationEntry = {
  readonly surah: number;
  readonly ayah: number;
  readonly text: string;
  readonly resourceId: number;
  /** The vendor's combined label, when it sent one. Optional in the schema and absent live. */
  readonly resourceName: string | null;
};

/**
 * A normalisation that succeeded, or the name of the check that refused it.
 *
 * ── Why the reason is returned rather than logged where it is discovered ────
 * `normalize.ts` has no logger and must not acquire one: it is a pure function over an untrusted
 * body, and a module that both inspects vendor content and writes to a log is one refactor away from
 * writing vendor content *to* the log. Returning the reason keeps the decision here and the emission
 * in `handler.ts`, where the record type is a closed allow-list.
 */
export type Normalized<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: NormalizeReason };

function rejected(
  reason: NormalizeReason,
): { readonly ok: false; readonly reason: NormalizeReason } {
  return { ok: false, reason };
}

/**
 * One translation object, with attribution treated as mandatory.
 *
 * ── The strictness here is deliberate, and it has a cost worth stating ───────
 * `resource_name` is **optional** in the vendor's OpenAPI schema — only `resource_id` and `text` are
 * required — and this function refuses an entry without it, which fails the whole response. That is a
 * choice with a real failure mode: if the vendor stops sending the name on this route, translations
 * stop rendering rather than rendering unattributed.
 *
 * It is the right way round. An unattributed rendering of the Qur'an presented next to the Arabic is
 * exactly what the domain model was built to make impossible — "an unattributed rendering is not
 * shippable" — and a missing translator is a defect that must be visible, not absorbed. The
 * alternative, inventing a placeholder attribution, would put NoorLife's guess where a translator's
 * name belongs.
 */
function readTranslationEntry(
  raw: unknown,
  expectedSurah: number,
  expectedResourceId: number,
): Normalized<TranslationEntry> {
  const entry = asRecord(raw);
  if (entry === null) {
    return rejected('envelope');
  }
  const key = parseVerseKey(entry.verse_key, expectedSurah);
  if (key === null) {
    return rejected('verse_key');
  }
  const resourceId = boundedInteger(entry.resource_id, 1, Number.MAX_SAFE_INTEGER);
  if (resourceId === null || resourceId !== expectedResourceId) {
    // An edition other than the one asked for. Rendering it would attribute the user's chosen
    // translation to a translator who did not write it.
    return rejected('resource_id');
  }
  /**
   * `resource_name` is **optional**, and its absence is not a defect.
   *
   * This function used to require it, and that requirement was a live bug: the vendor's schema marks
   * only `resource_id` and `text` as required, the API omits the label on both routes NoorLife
   * reads, and every valid translation was therefore rejected — `upstream_outcome: ok` followed by
   * NoorLife's own `502 upstream_unavailable`. Attribution is resolved by the caller from the
   * hierarchy in `resolveTranslationSource`; what is kept here is the label *if the vendor sent one*,
   * so it can be cross-checked and used as a last resort.
   */
  const resourceName = nonEmptyString(entry.resource_name);
  const rawText = entry.text;
  if (typeof rawText !== 'string') {
    return rejected('text_type');
  }
  const text = stripTranslationMarkup(rawText);
  if (text.length === 0) {
    // A translation that is empty once markup is removed was markup and nothing else.
    return rejected('text_empty');
  }
  return { ok: true, value: { surah: key.surah, ayah: key.ayah, text, resourceId, resourceName } };
}

/** One page of translations, once every check has passed. */
export type TranslationPage = {
  readonly translations: readonly WireTranslation[];
  readonly pagination: WirePagination;
  readonly source: WireSource;
};

export function normalizeTranslations(
  body: unknown,
  expectedSurah: number,
  expectedResourceId: number,
  catalogue?: TranslationAttribution,
): Normalized<TranslationPage> {
  const envelope = asRecord(body);
  if (envelope === null || !Array.isArray(envelope.translations)) {
    return rejected('envelope');
  }

  const entries: TranslationEntry[] = [];
  for (const raw of envelope.translations) {
    const entry = readTranslationEntry(raw, expectedSurah, expectedResourceId);
    if (!entry.ok) {
      /**
       * One bad row fails the page, and the row's own reason is what travels up.
       *
       * Failing the page rather than dropping the row is unchanged and deliberate: a page silently
       * missing verse 7 is a page that reads as though verse 7 has no translation. What is new is
       * that the *reason* survives, so a single malformed row no longer looks identical in the log
       * to a body that was not a translations envelope at all.
       */
      return entry;
    }
    entries.push(entry.value);
  }

  const label = singleEntryLabel(entries);
  if (label === CONFLICTING) {
    /**
     * Two rows in one response claiming different editions by name.
     *
     * The ids already matched the request — `readTranslationEntry` refuses anything else — so this
     * is a response that is internally inconsistent about what it is. Picking one label would be
     * choosing which of two contradictory claims to print above somebody's scripture.
     */
    return rejected('label_conflict');
  }

  /**
   * An empty page is a legitimate answer and is **not** an error.
   *
   * Paging past the last verse of a surah returns no entries, and the honest response is an empty
   * page the client renders as the end of the list. It carries no rows, so there is nothing to
   * attribute and no attribution to fail over — the source names the requested edition and stops.
   */
  if (entries.length === 0) {
    return {
      ok: true,
      value: {
        translations: [],
        pagination: readPagination(envelope.pagination),
        source: resolveTranslationSource(catalogue, readMetaAttribution(envelope), null) ??
          {
            name: CONTENT_SOURCE_NAME,
            edition: `Translation ${expectedResourceId}`,
            verified: true,
          },
      },
    };
  }

  const source = resolveTranslationSource(catalogue, readMetaAttribution(envelope), label);
  if (source === null) {
    /**
     * Rows to render and nobody to credit for them. Refused rather than shown unattributed.
     *
     * ── This is the branch the intermittent `502` was coming out of ──────────
     * Every check above passed: the envelope was a translations page, every row named the requested
     * surah and the requested edition, and every row carried real text. The *only* thing missing was
     * a name to put above it — which on the live API is never in the response and always comes from
     * the catalogue, a second upstream read that can fail on its own.
     *
     * The behaviour does not change. An unattributed rendering of the Qur'an is the one outcome this
     * path exists to prevent, and it stays prevented. What changes is that the reason now reaches the
     * log as `attribution` instead of being indistinguishable from a malformed vendor body — so the
     * remedy is aimed at NoorLife's catalogue read, which is where the defect actually is.
     */
    return rejected('attribution');
  }

  return {
    ok: true,
    value: {
      translations: entries.map((entry) => ({
        surah: entry.surah,
        ayah: entry.ayah,
        translationId: String(entry.resourceId),
        text: entry.text,
      })),
      pagination: readPagination(envelope.pagination),
      source,
    },
  };
}

/** Returned by `singleEntryLabel` when rows disagree about what edition they belong to. */
const CONFLICTING = Symbol('conflicting-resource-name');

/**
 * The one label every row agrees on, `null` when none carries one, or `CONFLICTING`.
 *
 * Rows that omit `resource_name` are simply silent — the field is optional, and silence is not
 * disagreement. What is disagreement is two rows naming *different* editions, and that fails closed.
 */
function singleEntryLabel(
  entries: readonly TranslationEntry[],
): string | null | typeof CONFLICTING {
  /**
   * Written as a scan rather than a `Set` deliberately. `source-scan_test.ts` asserts that the
   * content client's catalogue is the *only* keyed store in the function, which is what makes "no
   * verse is ever held here" checkable rather than asserted; a collection built in this module would
   * cost that guard for no benefit, since one label is all that is being looked for.
   */
  let label: string | null = null;
  for (const entry of entries) {
    if (entry.resourceName === null) {
      continue;
    }
    if (label !== null && label !== entry.resourceName) {
      return CONFLICTING;
    }
    label = entry.resourceName;
  }
  return label;
}

// ─────────────────────────────────────────────────────────────────────────────
// Catalogues
// ─────────────────────────────────────────────────────────────────────────────

function readEdition(raw: unknown): WireEdition | null {
  const resource = asRecord(raw);
  if (resource === null) {
    return null;
  }
  const id = boundedInteger(resource.id, 1, Number.MAX_SAFE_INTEGER);
  const name = nonEmptyString(resource.name);
  const language = nonEmptyString(resource.language_name);
  /**
   * The translator, and the reason an edition without one is dropped rather than listed.
   *
   * This list is what the preferences screen offers the user to choose from. An entry with no author
   * is an entry that, once chosen, would produce translations NoorLife could not attribute — so it is
   * better never offered. A single unusable entry does not fail the catalogue, because the rest of it
   * is still a correct list of editions that *can* be attributed.
   */
  const translator = nonEmptyString(resource.author_name);
  if (id === null || name === null || language === null || translator === null) {
    return null;
  }
  return { id: String(id), language, name, translator };
}

export function normalizeEditions(body: unknown): readonly WireEdition[] | null {
  const translations = asRecord(body)?.translations;
  if (!Array.isArray(translations)) {
    return null;
  }
  const editions: WireEdition[] = [];
  for (const raw of translations) {
    const edition = readEdition(raw);
    if (edition !== null) {
      editions.push(edition);
    }
  }
  return editions;
}

function readReciter(raw: unknown): WireReciter | null {
  const recitation = asRecord(raw);
  if (recitation === null) {
    return null;
  }
  const id = boundedInteger(recitation.id, 1, Number.MAX_SAFE_INTEGER);
  const name = nonEmptyString(recitation.reciter_name);
  if (id === null || name === null) {
    return null;
  }
  const style = nonEmptyString(recitation.style);
  return { id: String(id), name, ...(style === null ? {} : { style }) };
}

export function normalizeReciters(body: unknown): readonly WireReciter[] | null {
  const recitations = asRecord(body)?.recitations;
  if (!Array.isArray(recitations)) {
    return null;
  }
  const reciters: WireReciter[] = [];
  for (const raw of recitations) {
    const reciter = readReciter(raw);
    if (reciter !== null) {
      reciters.push(reciter);
    }
  }
  return reciters;
}

// ─────────────────────────────────────────────────────────────────────────────
// Recitation audio
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Turns an upstream `url` into an absolute URL on an allow-listed host, or rejects it.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * This is the control that makes returning audio URLs safe, and it is worth stating plainly what it
 * is defending against.
 *
 * Every other operation returns text and numbers. This one returns an address **the device will
 * fetch itself** — so whatever comes back here is, in effect, NoorLife telling its users where to
 * send a request. An upstream that changed, was misconfigured, or was compromised could name any
 * host on the internet, and without this check the function would forward it with its own authority
 * behind it.
 *
 * Three rules, and each rejects rather than repairs:
 *
 *   1. **Relative paths resolve against a fixed literal.** `AUDIO_BASE_URL` is a constant in this
 *      repository, not a value from the response, so a relative path has nowhere to escape to.
 *   2. **The scheme must be `https:`.** Not `http:`, not `data:`, not `file:`.
 *   3. **The host must be in `AUDIO_HOST_ALLOWLIST` exactly.** A suffix match would accept
 *      `verses.quran.foundation.attacker.example`, so the comparison is equality.
 *
 * A URL failing any of these is dropped and the verse simply has no audio, which the reader renders
 * as an unavailable play control. Silence is the correct failure here.
 * ═══════════════════════════════════════════════════════════════════════════
 */
export function normalizeAudioUrl(raw: unknown): string | null {
  const value = nonEmptyString(raw);
  if (value === null) {
    return null;
  }

  let parsed: URL;
  try {
    // The base is used only when `value` is relative; an absolute `value` ignores it entirely and is
    // then checked against the same allow-list.
    parsed = new URL(value, AUDIO_BASE_URL);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'https:') {
    return null;
  }
  if (!AUDIO_HOST_ALLOWLIST.includes(parsed.hostname)) {
    return null;
  }
  // Credentials in a URL are never legitimate here and are how a host check gets bypassed by
  // readers that stop at the `@`.
  if (parsed.username !== '' || parsed.password !== '') {
    return null;
  }
  /**
   * An origin with no path is not an audio file.
   *
   * Found by the tests rather than reasoned about in advance: a bare `"https://"` in a response
   * resolves against the base to `https://verses.quran.foundation/`, which passes the scheme and the
   * host check and would then be handed to the platform player as though it were a recitation. Every
   * real audio URL has a path, so requiring one costs nothing and closes the case.
   */
  if (parsed.pathname === '' || parsed.pathname === '/') {
    return null;
  }
  return parsed.toString();
}

/**
 * One page of per-verse recitation audio.
 *
 * A verse whose URL failed validation is **omitted**, not included with a null URL: the reader's
 * play control is rendered from the presence of an entry, so an entry that cannot be played would be
 * a control that cannot work.
 */
export function normalizeRecitations(
  body: unknown,
  expectedSurah: number,
): { readonly recitations: readonly WireRecitation[]; readonly pagination: WirePagination } | null {
  const record = asRecord(body);
  const files = record?.audio_files;
  if (!Array.isArray(files)) {
    return null;
  }

  const recitations: WireRecitation[] = [];
  for (const raw of files) {
    const file = asRecord(raw);
    if (file === null) {
      continue;
    }
    const key = parseVerseKey(file.verse_key, expectedSurah);
    if (key === null) {
      // A verse key for a different surah, or an unparseable one. Dropped rather than trusted —
      // the same rule the verse and translation normalisers apply.
      continue;
    }
    const url = normalizeAudioUrl(file.url);
    if (url === null) {
      continue;
    }
    const duration = boundedInteger(file.duration, 1, 60 * 60);
    recitations.push({
      surah: key.surah,
      ayah: key.ayah,
      url,
      ...(duration === null ? {} : { durationSeconds: duration }),
    });
  }

  return { recitations, pagination: readPagination(record?.pagination) };
}

// ─────────────────────────────────────────────────────────────────────────────
// The one entry point the handler uses
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Turns one upstream body into the payload for the operation that asked for it.
 *
 * Total over `QuranQuery`, so an operation added to the union is a compile error here until somebody
 * writes its normalisation — which is what stops a new route from reaching the client as an
 * unvalidated pass-through of whatever the vendor sent.
 */
export function normalizePayload(
  query: QuranQuery,
  body: unknown,
  catalogue?: TranslationAttribution,
): Normalized<QuranPayload> {
  switch (query.operation) {
    case 'list_chapters': {
      const chapters = normalizeChapters(body);
      return chapters === null
        ? rejected('shape')
        : { ok: true, value: { operation: 'list_chapters', chapters } };
    }

    case 'get_chapter': {
      const chapter = normalizeChapter(body, query.surah);
      return chapter === null
        ? rejected('shape')
        : { ok: true, value: { operation: 'get_chapter', chapter } };
    }

    case 'list_verses': {
      const page = normalizeVerses(body, query.surah);
      return page === null ? rejected('shape') : {
        ok: true,
        value: {
          operation: 'list_verses',
          verses: page.verses,
          pagination: page.pagination,
          source: scriptureSource(),
        },
      };
    }

    case 'list_verse_translations': {
      const page = normalizeTranslations(body, query.surah, query.translationId, catalogue);
      return page.ok
        ? {
          ok: true,
          value: {
            operation: 'list_verse_translations',
            translations: page.value.translations,
            pagination: page.value.pagination,
            source: page.value.source,
          },
        }
        : page;
    }

    case 'get_verse':
      return normalizeSingleVerse(body, query, catalogue);

    case 'list_translation_resources': {
      const editions = normalizeEditions(body);
      return editions === null
        ? rejected('shape')
        : { ok: true, value: { operation: 'list_translation_resources', editions } };
    }

    case 'list_recitation_resources': {
      const reciters = normalizeReciters(body);
      return reciters === null
        ? rejected('shape')
        : { ok: true, value: { operation: 'list_recitation_resources', reciters } };
    }

    case 'list_verse_recitations': {
      const page = normalizeRecitations(body, query.surah);
      return page === null ? rejected('shape') : {
        ok: true,
        value: {
          operation: 'list_verse_recitations',
          recitations: page.recitations,
          pagination: page.pagination,
        },
      };
    }
  }
}

/**
 * The Daily Ayah's payload — one verse, and its translation when one was asked for.
 *
 * The two travel as separate fields with separate sources, mirroring the domain model's separation of
 * `AyahText` from `AyahTranslation`. There is deliberately no shape here in which a translation could
 * be attached to the scripture object, so no reader downstream can conflate them.
 */
function normalizeSingleVerse(
  body: unknown,
  query: Extract<QuranQuery, { operation: 'get_verse' }>,
  catalogue?: TranslationAttribution,
): Normalized<QuranPayload> {
  const raw = asRecord(body)?.verse;
  const verse = readVerse(raw, query.surah);
  if (verse === null || verse.ayah !== query.ayah) {
    return rejected('shape');
  }

  const base = {
    operation: 'get_verse',
    verse,
    source: scriptureSource(),
  } as const;

  if (query.translationId === null) {
    return { ok: true, value: base };
  }

  const embedded = asRecord(raw)?.translations;
  if (!Array.isArray(embedded) || embedded.length !== 1) {
    /**
     * Exactly one translation was requested, so exactly one must come back.
     *
     * Several would mean choosing one, and choosing would be this function inventing a policy about
     * whose rendering the user sees. None means the edition returned nothing for this verse, which
     * the Daily Ayah cannot render as a verse-with-meaning.
     */
    return rejected('envelope');
  }

  /**
   * The embedded translation carries no `verse_key` of its own on this route, so the verse's own key
   * is the one it is attributed to. That is sound precisely because it is *embedded in* the verse
   * object this function has already identified — it is not a lookup across two responses.
   */
  const entry = asRecord(embedded[0]);
  const resourceId = boundedInteger(entry?.resource_id, 1, Number.MAX_SAFE_INTEGER);
  const rawText = entry?.text;
  if (resourceId === null || resourceId !== query.translationId || typeof rawText !== 'string') {
    // A different edition than the one asked for, or no text at all.
    return rejected(
      resourceId === null || resourceId !== query.translationId ? 'resource_id' : 'text_type',
    );
  }
  const text = stripTranslationMarkup(rawText);
  if (text.length === 0) {
    return rejected('text_empty');
  }

  /**
   * The same hierarchy the paginated route uses, for the same reason.
   *
   * `resource_name` is optional here too — the embedded object is the very same `translation`
   * component — so requiring it rejected valid Daily Ayah responses exactly as it rejected valid
   * pages. The catalogue is asked first, the response's own `meta` second, the entry's label last,
   * and a verse whose translation nobody can be credited for is refused rather than shown.
   */
  const translationSourceResolved = resolveTranslationSource(
    catalogue,
    readMetaAttribution(asRecord(body)),
    nonEmptyString(entry?.resource_name),
  );
  if (translationSourceResolved === null) {
    // The same fail-closed branch the paginated route has, reported under the same name so one
    // dashboard filter covers both surfaces the catalogue failure can reach a user through.
    return rejected('attribution');
  }

  const translation: WireTranslation = {
    surah: verse.surah,
    ayah: verse.ayah,
    translationId: String(resourceId),
    text,
  };
  return {
    ok: true,
    value: {
      ...base,
      translation,
      translationSource: translationSourceResolved,
    },
  };
}
