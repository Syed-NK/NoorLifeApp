import { hasData } from '../faith-result';
import type {
  AyahText,
  AyahTranslation,
  QuranContentRepository,
} from '../quran-content.repository';
import { surahNumber } from '../quran-content.repository';
import { verseKeysFor, type CuratedDhikrReference } from './quran-dhikr-catalogue';

/**
 * Resolving a curated reference into the scripture it names, through the approved boundary.
 *
 * ── The identity rule, which is the whole of this file ──────────────────────
 * **A verse's identity is its `verse_key`, never its position in an array.**
 *
 * This is not a stylistic preference. The reader had a defect of exactly this family — it announced
 * "opened at verse 255" because 255 was the number in the URL, while the array it was rendering
 * held verses 1 through 20 — and the same reasoning applied here would be worse: a dhikr entry
 * captioned `2:255` displaying whatever happened to be at index 254 of a page is a misattributed
 * verse of the Qur'an. So every fetched item is matched against the key the catalogue asked for, and
 * anything unmatched fails the whole resolution rather than being rendered under the wrong caption.
 *
 * ── Fail closed, in four places ─────────────────────────────────────────────
 * A resolution is refused when the Arabic is missing for any key, when a key comes back that was not
 * asked for, when the translation carries no attribution, and when the requested edition resolves to
 * nothing. Each of those has a tempting partial rendering — show the verses that did arrive, show
 * the Arabic without the translation, show the translation without the translator — and each of
 * those partial renderings is a claim NoorLife cannot support. The screen shows an honest
 * unavailable state instead.
 */

/** One verse of a resolved entry: the scripture, and its attributed translation. */
export type ResolvedDhikrVerse = {
  /** `surah:ayah`, the identity everything here is matched on. */
  readonly verseKey: string;
  /** Exactly as the source returned it. Never trimmed, normalised or re-pointed. */
  readonly arabic: string;
  readonly translation: string;
  /** The translator. Required — see `translatorOf`. */
  readonly translator: string;
};

export type ResolvedDhikr = {
  readonly entry: CuratedDhikrReference;
  /** In catalogue order, one per verse of the range. Never re-ordered by arrival. */
  readonly verses: readonly ResolvedDhikrVerse[];
  /** The translator credited for the whole selection, for the one-line credit. */
  readonly translator: string;
};

/** Why a curated reference could not be shown. Each maps to a different thing to tell the user. */
export type DhikrResolutionFailure =
  /** The source did not answer, or answered with an error. Retryable. */
  | 'unavailable'
  /**
   * The source answered and the verses it returned do not match the reference.
   *
   * Never retried automatically and never partially rendered: a mismatch means either the catalogue
   * names something that does not exist or the boundary returned something else, and both are
   * conditions under which displaying anything would be displaying the wrong verse.
   */
  | 'binding-failed'
  /** The translation arrived with no translator. Not displayable under the permission. */
  | 'attribution-missing'
  /** No translation edition has been resolved yet, so there is nothing to ask for. */
  | 'no-translation-selected';

export type DhikrResolution =
  | { readonly kind: 'resolved'; readonly data: ResolvedDhikr }
  | { readonly kind: 'failed'; readonly reason: DhikrResolutionFailure };

/**
 * The translator, from the translation's own `ContentSource`.
 *
 * `attribution` is the translator on the approved adapter's contract, and `name` is the edition. A
 * translation with neither is refused rather than credited to the source in the translator's place —
 * "translated by Quran Foundation" would be a false statement about a person's work.
 */
function translatorOf(translation: AyahTranslation): string | null {
  const { attribution } = translation.source;
  return attribution === undefined || attribution.trim() === '' ? null : attribution;
}

function keyOf(item: { readonly surah: number; readonly ayah: number }): string {
  return `${item.surah}:${item.ayah}`;
}

/**
 * Fetches and binds the verses one curated reference names.
 *
 * ── Why the whole surah is requested rather than the range ──────────────────
 * The approved boundary pages by surah and has no by-range operation, and adding one would be new
 * API scope the permission explicitly says is not required. So the surah's verses are read through
 * the operation that already exists and the range is selected here, by key. That is more bytes than
 * the range needs and exactly zero new scope, which is the correct trade for a feature whose whole
 * permission rests on needing none.
 */
export async function resolveDhikrReference(
  quran: QuranContentRepository,
  entry: CuratedDhikrReference,
  translationId: string | null,
): Promise<DhikrResolution> {
  if (translationId === null) {
    /*
      Refused rather than falling back to Arabic alone. The permission requires the translator's
      name with every translation; it does not require a translation to exist. But a dhikr entry
      whose meaning is absent is a different feature from the one that was reviewed, and choosing
      silently between them is not this layer's call.
    */
    return { kind: 'failed', reason: 'no-translation-selected' };
  }

  const wanted = verseKeysFor(entry);
  const surah = surahNumber(entry.surah);

  /*
    A page size that covers the longest surah in one request. The boundary caps `per_page`, so this
    is `limit` at its ceiling and the loop below walks any remainder — Al-Baqarah's 286 verses are
    six pages, and a range in it must not be silently truncated at 50.
  */
  const arabic = new Map<string, AyahText>();
  const translated = new Map<string, AyahTranslation>();

  let cursor: string | undefined;
  let guard = 0;
  do {
    const request = cursor === undefined ? {} : { cursor };
    const [text, translation] = await Promise.all([
      quran.listAyahs(surah, request),
      quran.listTranslations(surah, translationId, request),
    ]);
    if (!hasData(text)) {
      return { kind: 'failed', reason: 'unavailable' };
    }
    for (const item of text.data.items) {
      arabic.set(keyOf(item), item);
    }
    if (hasData(translation)) {
      for (const item of translation.data.items) {
        translated.set(keyOf(item), item);
      }
    }
    cursor = text.data.nextCursor ?? undefined;
    guard += 1;
    /*
      Stop as soon as every wanted key is in hand. A range in Al-Fatihah costs one request rather
      than however many pages the surah happens to have.
    */
    if (wanted.every((key) => arabic.has(key) && translated.has(key))) {
      break;
    }
  } while (cursor !== undefined && guard < MAX_RESOLUTION_PAGES);

  const verses: ResolvedDhikrVerse[] = [];
  let translator: string | null = null;

  /*
    Iterated over `wanted`, not over what arrived. Catalogue order is therefore the render order by
    construction, and a verse the source did not send is a missing key rather than a short array
    nobody notices.
  */
  for (const key of wanted) {
    const text = arabic.get(key);
    const translation = translated.get(key);
    if (text === undefined || translation === undefined) {
      return { kind: 'failed', reason: 'binding-failed' };
    }
    const credited = translatorOf(translation);
    if (credited === null) {
      return { kind: 'failed', reason: 'attribution-missing' };
    }
    /*
      One selection, one translator. A range whose verses came back credited to two different people
      is not a coherent rendering, and picking the first would be inventing a credit for the rest.
    */
    if (translator !== null && translator !== credited) {
      return { kind: 'failed', reason: 'attribution-missing' };
    }
    translator = credited;
    verses.push({
      verseKey: key,
      // Copied, not processed. This is the last place the Arabic passes through before the cache.
      arabic: text.arabic,
      translation: translation.text,
      translator: credited,
    });
  }

  if (translator === null || verses.length === 0) {
    return { kind: 'failed', reason: 'binding-failed' };
  }

  return { kind: 'resolved', data: { entry, verses, translator } };
}

/**
 * How many pages one reference may read before giving up.
 *
 * Al-Baqarah at the boundary's default page size is the worst case in the Qur'an. The bound exists
 * so a source that returned a cursor pointing at itself cannot spin: a malformed cursor is a bug
 * somewhere, and the honest outcome is `binding-failed` rather than an endless read.
 */
const MAX_RESOLUTION_PAGES = 20;
