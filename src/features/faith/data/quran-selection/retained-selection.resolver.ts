import type { RetainedQuran, RetainedQuranSource } from '../offline/retained-quran.source';
import {
  selectionReferenceLabel,
  selectionVerseKeys,
  type QuranSelectionRef,
} from './quran-selection';

/**
 * Turning a reference into the scripture it names — **from the device, and only from the device.**
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Why this resolver exists beside `resolveDhikrReference` ────────────────
 * `quran-dhikr.repository.ts` resolves a curated reference through `QuranContentRepository`, which
 * means it may reach the network. That is correct for what it does: a handful of reviewed entries,
 * resolved once, cached, refreshed on a schedule.
 *
 * It is wrong for this. Selections are rendered on the Tasbih control card, in three sections of the
 * Duas screen and in the selector's preview — surfaces that are drawn on entry, on scroll and on
 * every count. Resolving those through a repository that can fall through to a request would put
 * Quran Foundation traffic behind ordinary rendering, which the offline requirement forbids and
 * which no amount of caching makes acceptable in principle. So this reads the published generation
 * and stops there. **Nothing here can issue a request**, because nothing here holds anything that
 * could: the only input is `RetainedQuranSource`.
 *
 * The consequence is honest and is the one the product wants: on a device with a published
 * generation, selections resolve cold, in an aeroplane, on the first frame. On a device without one
 * they resolve to `no-generation`, and the screen says the Qur'an has not been downloaded yet and
 * offers the way to do it — rather than spinning against a network somebody may not have.
 *
 * ── Identity is the verse key, never the position ──────────────────────────
 * Every verse is matched on `surah:ayah` against the key the reference asked for. A selection
 * captioned `2:255` that rendered whatever sat at index 254 of an array would be a misattributed
 * verse of the Qur'an, and the reader has had a defect of exactly that family. A key that is missing
 * fails the whole resolution rather than shortening the range.
 *
 * ── The translation may be absent, and the Arabic may not ──────────────────
 * A generation holds Arabic for every verse and a translation for the one resource it retained. A
 * selection whose translation is missing renders as scripture with the meaning marked unavailable —
 * NoorLife is entitled to show the Arabic, and hiding it because a translation did not resolve would
 * withhold the thing the user actually asked for. A translation with **no translator** is a different
 * case and is dropped: the licence requires the credit wherever the translation appears, so a
 * rendering that cannot name its translator is one this app must not draw.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** One resolved verse: the scripture, and its meaning where the device holds one. */
export type ResolvedSelectionVerse = {
  /** `surah:ayah`, the identity everything here is matched on. */
  readonly verseKey: string;
  readonly ayah: number;
  /** Exactly as the publisher sent it. Copied, never trimmed, normalised or re-pointed. */
  readonly arabic: string;
  /** `null` when this device holds no translation for the verse. */
  readonly translation: string | null;
};

export type ResolvedSelection = {
  readonly ref: QuranSelectionRef;
  /** In reference order, one per verse of the range. Never re-ordered by arrival. */
  readonly verses: readonly ResolvedSelectionVerse[];
  /** The translator credited for the whole selection, or `null` when no translation resolved. */
  readonly translator: string | null;
  /** The translation edition's own name, shown beside the translator. `null` with no translation. */
  readonly translationEdition: string | null;
  /** `2:255` or `59:22-24`. Carried so a caller renders one string rather than recomputing it. */
  readonly reference: string;
};

/** Why a reference could not be resolved from what this device holds. */
export type SelectionResolutionFailure =
  /** No generation is published, or it holds no Arabic. The Qur'an has not been downloaded. */
  | 'no-generation'
  /**
   * The generation is published and does not contain every verse of the range.
   *
   * Never partially rendered. A range that is short by one verse is not a shorter range, it is a
   * passage with a hole in it, and the user has no way to see which verse is missing.
   */
  | 'range-missing';

export type SelectionResolution =
  | { readonly kind: 'resolved'; readonly data: ResolvedSelection }
  | { readonly kind: 'failed'; readonly reason: SelectionResolutionFailure };

/**
 * The surahs the device holds, and how many verses each has.
 *
 * ── Why the counts come from here rather than a table ──────────────────────
 * The 114 verse counts are the publisher's, delivered with the dataset that was validated as
 * complete before it was published. Writing them into this repository would be authoring scholarly
 * reference data NoorLife has no standing to author, and a table that disagreed with the generation
 * by one would produce a selector offering a verse the resolver then could not find.
 */
export type RetainedSurahIndex = ReadonlyMap<number, number>;

export function retainedSurahIndex(content: RetainedQuran | null): RetainedSurahIndex {
  const index = new Map<number, number>();
  const arabic = content?.arabic;
  if (arabic === undefined || arabic === null) {
    return index;
  }
  for (const [surah, verses] of arabic.bySurah) {
    /*
      The highest ayah number, not the row count. They are equal for a validated dataset, and if they
      ever diverged the count that matters is the one a user could legitimately ask for.
    */
    let highest = 0;
    for (const verse of verses) {
      highest = Math.max(highest, verse.ayah);
    }
    if (highest > 0) {
      index.set(surah, highest);
    }
  }
  return index;
}

/** Resolves one reference against already-read content. Pure, so a screen can call it per row. */
export function resolveSelectionFrom(
  content: RetainedQuran | null,
  ref: QuranSelectionRef,
): SelectionResolution {
  const arabic = content?.arabic ?? null;
  if (arabic === null) {
    return { kind: 'failed', reason: 'no-generation' };
  }

  const arabicVerses = arabic.bySurah.get(ref.surah);
  if (arabicVerses === undefined || arabicVerses.length === 0) {
    return { kind: 'failed', reason: 'range-missing' };
  }

  const arabicByAyah = new Map(arabicVerses.map((verse) => [verse.ayah, verse.text]));

  /*
    The translation is optional and its credit is not. `translations` is already `null` when the
    generation holds rows with no attribution — see `retained-quran.source.ts`, which refuses to
    serve them — so reaching a non-null value here means the credit exists.
  */
  const translations = content?.translations ?? null;
  const translationByAyah = new Map(
    (translations?.bySurah.get(ref.surah) ?? []).map((verse) => [verse.ayah, verse.text]),
  );
  const translator = translations?.source.attribution ?? null;
  const translationEdition = translations?.source.edition ?? null;

  const verses: ResolvedSelectionVerse[] = [];
  /*
    Iterated over the keys the reference asked for, not over what the generation happens to hold. The
    reference's order is therefore the render order by construction, and a verse the device does not
    have is a missing key rather than a short array nobody notices.
  */
  for (const verseKey of selectionVerseKeys(ref)) {
    const ayah = Number(verseKey.split(':')[1]);
    const text = arabicByAyah.get(ayah);
    if (text === undefined) {
      return { kind: 'failed', reason: 'range-missing' };
    }
    verses.push({
      verseKey,
      ayah,
      arabic: text,
      translation: translator === null ? null : (translationByAyah.get(ayah) ?? null),
    });
  }

  const anyTranslation = verses.some((verse) => verse.translation !== null);

  return {
    kind: 'resolved',
    data: {
      ref,
      verses,
      /*
        The credit is carried only when there is something to credit. Naming a translator beside a
        selection whose meaning did not resolve would attribute a rendering that is not on screen.
      */
      translator: anyTranslation ? translator : null,
      translationEdition: anyTranslation ? translationEdition : null,
      reference: selectionReferenceLabel(ref),
    },
  };
}

/** Reads the generation once and resolves against it. Awaits storage; never a network. */
export async function resolveSelection(
  retained: RetainedQuranSource,
  ref: QuranSelectionRef,
): Promise<SelectionResolution> {
  return resolveSelectionFrom(await retained.read(), ref);
}
