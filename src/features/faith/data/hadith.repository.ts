import type { ContentSource, FaithPage, FaithPageRequest, FaithResult } from './faith-result';

/**
 * Hadith content.
 *
 * ── Grading is not optional ─────────────────────────────────────────────────
 * `grade` is a required field. A hadith presented without its authentication grade
 * invites the reader to treat a weak narration as a sound one, which is the specific
 * harm this module must not cause. There is no `grade?:` and no default — a narration
 * whose grade is unknown must be constructed as `{ grade: 'unknown' }`, which the UI
 * renders with a visible caution rather than silently.
 *
 * As with the Qur'an, Arabic text is immutable and translations are separately
 * attributed.
 */

export type HadithGrade = 'sahih' | 'hasan' | 'daif' | 'mawdu' | 'unknown';

/** A canonical collection, e.g. Sahih al-Bukhari. */
export type HadithCollection = {
  readonly id: string;
  readonly name: string;
  readonly arabicName: string;
  readonly compiler: string;
  readonly narrationCount: number;
};

export type Hadith = {
  readonly id: string;
  readonly collectionId: string;
  /** Book and number within the collection, e.g. "Book 2, Hadith 13". */
  readonly reference: string;
  /** Immutable Arabic, where the source provides it. */
  readonly arabic?: string;
  readonly translation: string;
  readonly narrator: string;
  /** Required. See the note above. */
  readonly grade: HadithGrade;
  readonly topics: readonly string[];
  readonly source: ContentSource;
};

export type HadithRepository = {
  listCollections(): Promise<FaithResult<readonly HadithCollection[]>>;

  listByCollection(
    collectionId: string,
    page?: FaithPageRequest,
  ): Promise<FaithResult<FaithPage<Hadith>>>;

  getHadith(id: string): Promise<FaithResult<Hadith>>;

  /** Powers the Faith search screen's Hadith tab. */
  search(query: string, page?: FaithPageRequest): Promise<FaithResult<FaithPage<Hadith>>>;

  /** The narration quoted on the home screen's Faith AI insight card. */
  getDailyHadith(): Promise<FaithResult<Hadith>>;
};
