import type {
  AyahText,
  AyahTranslation,
  QuranContentRepository,
  SurahNumber,
  SurahSummary,
  TranslationId,
} from '../quran-content.repository';
import { ayahNumber, surahNumber } from '../quran-content.repository';
import type { FaithPage, FaithPageRequest, FaithResult } from '../faith-result';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '../quran-foundation/quran-foundation.contract';
import { readCachedCatalogue } from '../../storage/faith-quran-catalogue';
import type { RetainedQuranSource } from './retained-quran.source';

/**
 * Reading from what the device has already retained, before reaching for the network.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Retained first, and why that is the point rather than an optimisation ──
 * The 2026-08-18 permission allows retaining the complete Arabic text for **in-app offline reading**
 * and requires checking for updates every seven connected days. That is a design, not two unrelated
 * clauses: the retained copy is meant to be what the reader reads, and the seven-day check is the
 * mechanism that keeps it current. Treating the retained text as a last-resort fallback would invert
 * it — every open would spend requests on text already on the phone, and the offline case would be
 * the only one the retained copy ever served.
 *
 * So this asks the generation first and the network second. A device that has the text reads it
 * cold, in an aeroplane, on the first frame after launch.
 *
 * ── What "fall through" means, and why it is never a substitution ──────────
 * When there is no published generation, no Arabic in it, or nothing for the surah asked for, this
 * delegates to the inner repository unchanged. It never mixes the two: a page is served entirely
 * from retained content or entirely by the inner repository. A page half from disk and half from the
 * wire would be two answers about the same surah stitched into one, and the seam is exactly where a
 * missing verse would hide.
 *
 * ── Metadata keeps its own, shorter window ─────────────────────────────────
 * `getSurah` is answered from the surah catalogue cache, which has its own licence ceiling — the
 * Arabic permission expressly does not broaden metadata rights, so nothing here extends it. A device
 * offline past that window fails `getSurah` and the reader shows its offline state, which is the
 * honest outcome: this app may hold the scripture indefinitely and the chapter list only for a week.
 *
 * ── The cursor contract ────────────────────────────────────────────────────
 * Cursors issued here are page numbers, matching what the inner repository issues, so a reader that
 * holds a cursor across a publication — or across the point where retained content becomes available
 * — hands back something both sides understand. The reader never computes one either way.
 * ═══════════════════════════════════════════════════════════════════════════
 */

type Verse = { readonly ayah: number; readonly text: string };

/** Decodes a caller's page request. Mirrors the inner repository, so one cursor works on both. */
function paging(page?: FaithPageRequest): { readonly page: number; readonly perPage: number } {
  const parsed = page?.cursor === undefined ? Number.NaN : Number.parseInt(page.cursor, 10);
  const limit = page?.limit;
  return {
    page: Number.isInteger(parsed) && parsed >= 1 ? parsed : 1,
    perPage:
      typeof limit === 'number' && Number.isFinite(limit)
        ? Math.min(Math.max(Math.floor(limit), 1), MAX_PAGE_SIZE)
        : DEFAULT_PAGE_SIZE,
  };
}

function slice(verses: readonly Verse[], request?: FaithPageRequest) {
  const { page, perPage } = paging(request);
  const start = (page - 1) * perPage;
  const items = verses.slice(start, start + perPage);
  return {
    items,
    nextCursor: start + perPage < verses.length ? String(page + 1) : null,
    total: verses.length,
  };
}

export function createOfflineQuranRepository(
  inner: QuranContentRepository,
  retained: RetainedQuranSource,
): QuranContentRepository {
  /**
   * The retained verses for one surah, with the held dataset they came from.
   *
   * An empty list is treated as absent rather than as an empty page. A retained dataset that
   * validated as complete has verses for every surah, so nothing here should ever be empty — and if
   * it is, the honest response is to let the network answer rather than to report a surah with no
   * verses in it.
   */
  const versesIn = <T extends { readonly bySurah: ReadonlyMap<number, readonly Verse[]> }>(
    held: T | null,
    surah: SurahNumber,
  ): { readonly verses: readonly Verse[]; readonly held: T } | null => {
    const verses = held?.bySurah.get(surah);
    return held === null || verses === undefined || verses.length === 0 ? null : { verses, held };
  };

  return {
    ...inner,

    /**
     * The chapter summary, from the metadata cache the catalogue warm-up already fills.
     *
     * Read through `readCachedCatalogue`, which enforces the metadata licence window and drops an
     * entry past it. That is deliberately a different and shorter life than the retained scripture's:
     * this reads the same store the online path populates rather than keeping a second copy.
     */
    async getSurah(surah: SurahNumber): Promise<FaithResult<SurahSummary>> {
      const catalogue = await readCachedCatalogue();
      const chapter = catalogue?.chapters.find((entry) => entry.number === surah);
      if (chapter === undefined) {
        return await inner.getSurah(surah);
      }
      return {
        kind: 'ok',
        data: {
          number: surahNumber(chapter.number),
          name: chapter.name,
          arabicName: chapter.arabicName,
          meaning: chapter.meaning,
          ayahCount: chapter.ayahCount,
          revelation: chapter.revelation,
        },
      };
    },

    async listAyahs(
      surah: SurahNumber,
      page?: FaithPageRequest,
    ): Promise<FaithResult<FaithPage<AyahText>>> {
      const content = await retained.read();
      const found = versesIn(content?.arabic ?? null, surah);
      if (found === null) {
        return await inner.listAyahs(surah, page);
      }
      const { items, nextCursor, total } = slice(found.verses, page);
      if (items.length === 0) {
        /* Paged past the end of the surah. Honest, and the same answer the inner repository gives. */
        return { kind: 'empty' };
      }
      return {
        kind: 'ok',
        data: {
          items: items.map((verse) => ({
            surah,
            ayah: ayahNumber(verse.ayah),
            /* Copied out of the validated dataset. There is no transformation on this path. */
            arabic: verse.text,
            source: found.held.source,
          })),
          nextCursor,
          total,
        },
      };
    },

    /**
     * The retained translation, but only the one that was actually retained.
     *
     * A generation holds exactly one translation resource. A reader asking for any other edition is
     * asking for text this device does not have, and answering with the one it does have would
     * silently substitute one translator's reading of the meaning for another's — the single worst
     * thing this layer could do. So the resource id must match, and anything else goes to the
     * network.
     */
    async listTranslations(
      surah: SurahNumber,
      translationId: TranslationId,
      page?: FaithPageRequest,
    ): Promise<FaithResult<FaithPage<AyahTranslation>>> {
      const content = await retained.read();
      const found = versesIn(content?.translations ?? null, surah);
      /*
        A generation holds exactly one translation resource, so a reader asking for any other edition
        is asking for text this device does not have.
      */
      if (found === null || String(found.held.resourceId) !== translationId) {
        return await inner.listTranslations(surah, translationId, page);
      }
      const { items, nextCursor, total } = slice(found.verses, page);
      if (items.length === 0) {
        return { kind: 'empty' };
      }
      return {
        kind: 'ok',
        data: {
          items: items.map((verse) => ({
            surah,
            ayah: ayahNumber(verse.ayah),
            translationId,
            text: verse.text,
            source: found.held.source,
          })),
          nextCursor,
          total,
        },
      };
    },
  };
}
