import { MAX_PAGE_SIZE } from '../quran-foundation/quran-foundation.contract';
import type { QuranContentRepository, ReciterId, SurahNumber } from '../quran-content.repository';
import { hasData } from '../faith-result';
import { openGeneration, readActiveGeneration } from '../../storage/faith-sync-generation';
import { PERMITTED_RESOURCE_ID } from '../../storage/faith-offline-recitation';
import type {
  BoundGeneration,
  GenerationSource,
  RecitationUrlResolver,
} from './offline-download.service';
import type { PublishedRow } from './offline-reconcile';

/**
 * The two seams that connect the offline downloader to the rest of the app.
 *
 * Kept apart from the engine so that the engine's tests drive plain objects rather than a repository,
 * an edge function and a filesystem — and so the two things most likely to change (how a URL is
 * fetched, how a generation is opened) change in one small file rather than inside a state machine.
 */

/**
 * Resolves one surah's audio URLs by walking the approved paged operation to its end.
 *
 * ── Why the cursor is carried and never computed ───────────────────────────
 * `FaithPage.nextCursor` is documented as opaque, and the two Qur'an repositories encode it
 * differently — one returns a page number, the other a vendor token. Constructing the next cursor
 * from a page count works against whichever one is wired today and silently fetches the wrong page
 * against the other, which for recitation means resolving verse 51 under verse 1's URL. So the cursor
 * that came back is the cursor that goes in, and the walk stops when the source says `null`.
 *
 * ── Why the whole surah is resolved before any of it is downloaded ─────────
 * Because a partially-resolved surah is a surah with a hole in it, and the engine's contract is that
 * it never leaves one. Resolving first also bounds how long vendor URLs are held: one surah's worth,
 * for the duration of that surah's transfers, discarded when the map goes out of scope. Al-Baqarah is
 * the worst case at six pages; most surahs are one.
 */
export function createRepositoryUrlResolver(
  quran: QuranContentRepository,
  reciterId: ReciterId,
): RecitationUrlResolver {
  return {
    async resolve(surah, signal) {
      const urls = new Map<number, string>();
      let cursor: string | undefined;

      /*
        Bounded by the longest surah's page count rather than looping until a null cursor arrives. A
        source that returned a non-null cursor forever — a bug, or a proxy rewriting the response —
        would otherwise spin here indefinitely against the user's connection. 286 verses at the
        vendor's maximum page size is six pages; the bound is generous and finite.
      */
      const maxPages = Math.ceil(300 / MAX_PAGE_SIZE) + 1;

      for (let page = 0; page < maxPages; page += 1) {
        if (signal.aborted) {
          return { kind: 'failed', reason: 'offline' };
        }
        const result = await quran.listRecitations(surah as SurahNumber, reciterId, {
          limit: MAX_PAGE_SIZE,
          ...(cursor === undefined ? {} : { cursor }),
        });

        if (result.kind === 'offline') {
          return { kind: 'failed', reason: 'offline' };
        }
        if (!hasData(result)) {
          /*
            `empty`, `error` and every other payload-free outcome collapse to `unavailable`. The
            distinction the engine acts on is only whether waiting will help, and for all of these it
            will not — a retry is the user's decision rather than an automatic wait.
          */
          return { kind: 'failed', reason: 'unavailable' };
        }

        for (const item of result.data.items) {
          urls.set(item.ayah, item.url);
        }

        const next = result.data.nextCursor;
        if (next === null) {
          return { kind: 'ok', urls };
        }
        cursor = next;
      }

      /* The source kept offering pages past any real surah. Treated as unusable rather than trusted. */
      return { kind: 'failed', reason: 'unavailable' };
    },
  };
}

/**
 * Reduces a validated generation to the recitation rows a downloader needs.
 *
 * Filtered to the permitted resource here rather than downstream, so nothing beyond this function can
 * hand the engine a row belonging to another reciter. The generation's own `resourceId` is checked
 * too: a publication whose recitation dataset is not resource 3 is not a thing this feature may
 * download under the extended-retention permission, and answering `null` is the honest response.
 */
function toBound(generation: {
  readonly manifest: { readonly generationId: string };
  readonly recitations: {
    readonly resourceId: number;
    readonly rows: readonly {
      readonly verseKey: string;
      readonly surah: number;
      readonly ayah: number;
      readonly bytes: number | null;
      readonly durationSeconds: number | null;
      readonly sequence: number | null;
    }[];
  };
}): BoundGeneration | null {
  if (generation.recitations.resourceId !== PERMITTED_RESOURCE_ID) {
    return null;
  }
  const rows: PublishedRow[] = generation.recitations.rows.map((row) => ({
    surah: row.surah,
    ayah: row.ayah,
    verseKey: row.verseKey,
    bytes: row.bytes,
    durationSeconds: row.durationSeconds,
    sequence: row.sequence,
  }));
  return { generationId: generation.manifest.generationId, rows };
}

/**
 * The Content Sync generation source.
 *
 * `open` exists so a run can re-read **its own** generation rather than whatever the pointer now
 * names. That is the whole of the "do not mix rows from two generations during one mutation" rule:
 * a publication landing mid-download changes the pointer, and a downloader that consulted the pointer
 * again would start resolving verses against rows the files it already promoted were never compared
 * to.
 */
export function createGenerationSource(): GenerationSource {
  return {
    async active(): Promise<BoundGeneration | null> {
      const generation = await readActiveGeneration();
      return generation === null ? null : toBound(generation);
    },

    open(generationId): BoundGeneration | null {
      const generation = openGeneration(generationId);
      return generation === null ? null : toBound(generation);
    },
  };
}
