import type { ContentSource } from '../faith-result';
import type { TranslationAttribution } from '../../storage/faith-sync-rows';
import {
  readActiveGenerationSync,
  readGenerationPointer,
} from '../../storage/faith-sync-generation';

/**
 * The published generation, indexed for reading. The one place retained content is turned into text.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Why this exists rather than the reader calling the storage layer ───────
 * `readActiveGeneration` opens every dataset file, re-checksums it and re-validates 6,236 rows. That
 * is exactly right once per publication and ruinous once per page of a scrolling reader. So the
 * generation is read at most once per `generationId`, indexed by surah, and served from memory
 * afterwards — and the cheap AsyncStorage pointer read is what decides whether the cache still
 * describes what is published.
 *
 * ── Invalidation is by pointer, which is the only thing that changes ───────
 * A generation is immutable: its directory is written once and never edited, and a new publication
 * is a new directory and a new pointer value. So "has the content changed?" is exactly "has the
 * pointer changed?", and there is no staleness this can miss — no timestamp to compare, no
 * modification to watch for.
 *
 * ── What is served, and what deliberately is not ───────────────────────────
 * Arabic and the translation rows the generation already holds. Both are content this device has
 * lawfully retained: the Arabic under the 2026-08-18 permission, the translation under the Content
 * Sync terms for resource 85. Nothing here fetches, and nothing here can produce content the
 * publisher did not send — every string is copied out of a validated dataset unchanged.
 *
 * Chapter metadata is **not** served from here. The generation holds no chapter list, the Arabic
 * permission expressly does not broaden metadata rights, and deriving a surah's name from retained
 * scripture is not something the text can honestly support. Metadata keeps its own cache and its own
 * shorter licence window.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** The publisher, as it is named wherever retained content is shown. */
export const RETAINED_PUBLISHER = 'Quran Foundation';

export type RetainedArabic = {
  readonly generationId: string;
  readonly script: string;
  /** Epoch milliseconds of the last completed seven-day Arabic check. */
  readonly lastCheckedAt: number;
  readonly source: ContentSource;
  /** Surah number → its verses, in ayah order. Built once per generation. */
  readonly bySurah: ReadonlyMap<
    number,
    readonly { readonly ayah: number; readonly text: string }[]
  >;
};

export type RetainedTranslations = {
  readonly generationId: string;
  readonly resourceId: number;
  readonly source: ContentSource;
  readonly bySurah: ReadonlyMap<
    number,
    readonly { readonly ayah: number; readonly text: string }[]
  >;
};

export type RetainedQuran = {
  readonly generationId: string;
  readonly arabic: RetainedArabic | null;
  readonly translations: RetainedTranslations | null;
};

export type RetainedQuranSource = {
  /** The retained content of the currently published generation, or `null` when there is none. */
  read(): Promise<RetainedQuran | null>;
};

function indexRows(
  rows: readonly { readonly surah: number; readonly ayah: number; readonly text: string }[],
): ReadonlyMap<number, readonly { readonly ayah: number; readonly text: string }[]> {
  const bySurah = new Map<number, { readonly ayah: number; readonly text: string }[]>();
  for (const row of rows) {
    const existing = bySurah.get(row.surah);
    /* Copied field by field: nothing downstream may reach a row object and mutate the dataset. */
    const entry = { ayah: row.ayah, text: row.text };
    if (existing === undefined) {
      bySurah.set(row.surah, [entry]);
    } else {
      existing.push(entry);
    }
  }
  for (const verses of bySurah.values()) {
    /*
      Sorted here so every reader sees ayat in order regardless of the order the dataset happened to
      be written in. Paging depends on this: a page is a slice, and a slice of an unordered list is
      not a page of a surah.
    */
    verses.sort((left, right) => left.ayah - right.ayah);
  }
  return bySurah;
}

/**
 * The credit shown against retained text.
 *
 * `verified` is `true` because this content came from the approved source through the approved
 * transport and was validated in full before it was ever published — retaining it did not make it
 * less checked. What would be dishonest is the reverse: marking lawfully retained publisher text as
 * unverified, which would put a warning on screen that says nothing true.
 */
function arabicSource(script: string): ContentSource {
  return { name: RETAINED_PUBLISHER, edition: `Uthmani script (${script})`, verified: true };
}

function translationSource(attribution: TranslationAttribution): ContentSource {
  return {
    name: RETAINED_PUBLISHER,
    edition: attribution.name,
    attribution: attribution.translator,
    verified: true,
  };
}

export function createRetainedQuranSource(): RetainedQuranSource {
  let cached: RetainedQuran | null = null;

  return {
    async read(): Promise<RetainedQuran | null> {
      const pointer = await readGenerationPointer();
      if (pointer === null) {
        /* Nothing is published. A previously cached generation is no longer the active one. */
        cached = null;
        return null;
      }
      if (cached !== null && cached.generationId === pointer.generationId) {
        return cached;
      }

      const generation = readActiveGenerationSync(pointer);
      if (generation === null) {
        /*
          The pointer names a generation that will not open or will not validate. Serving the
          previously cached one would be serving content the device no longer considers published,
          so this answers with nothing and the caller falls through to the network.
        */
        cached = null;
        return null;
      }

      const arabic: RetainedArabic | null =
        generation.arabic === null
          ? null
          : {
              generationId: pointer.generationId,
              script: generation.arabic.script,
              lastCheckedAt: generation.arabic.lastCheckedAt,
              source: arabicSource(generation.arabic.script),
              bySurah: indexRows(generation.arabic.rows),
            };

      const attribution = generation.translations.attribution;
      const translations: RetainedTranslations | null =
        attribution === null || generation.translations.rows.length === 0
          ? /*
               Rows with no translator credit are not servable. The licence requires the credit to
               remain visible wherever the translation appears, and a page that cannot name its
               translator is one this reader must not draw — so it falls through to the network,
               which resolves the credit as part of answering.
             */
            null
          : {
              generationId: pointer.generationId,
              resourceId: generation.translations.resourceId,
              source: translationSource(attribution),
              bySurah: indexRows(generation.translations.rows),
            };

      cached = { generationId: pointer.generationId, arabic, translations };
      return cached;
    },
  };
}
