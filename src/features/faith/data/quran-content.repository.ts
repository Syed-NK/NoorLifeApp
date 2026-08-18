import type { ContentSource, FaithPage, FaithPageRequest, FaithResult } from './faith-result';

/**
 * Qur'an content.
 *
 * ── The immutability rule, expressed in the type system ─────────────────────
 * Qur'anic Arabic is never edited, never normalised, never "cleaned up" and never
 * machine-translated by this app. Every field carrying it is `readonly`, the repository
 * exposes no write method for verse text, and `AyahText.arabic` is the *only* place the
 * Arabic lives — there is no second field a transform could write into.
 *
 * That is a contract, not an optimisation. A translation is a separate, attributed
 * object (`AyahTranslation`) so a translated string can never be mistaken for scripture,
 * and `TranslationId` is required to fetch one — there is no "default translation"
 * fallback that could silently attribute a rendering to nobody.
 *
 * ── What this interface does not do ─────────────────────────────────────────
 * It does not know about HTTP, Quran Foundation, or any vendor. The approved-source
 * adapter is described in `quran-foundation/quran-foundation.contract.ts` and is bound
 * server-side; this interface is what the presentation layer depends on, and it is
 * satisfied today by a local mock.
 */

/** Surah number, 1–114. Branded so a raw integer cannot be passed by mistake. */
export type SurahNumber = number & { readonly __brand: 'SurahNumber' };

/** Ayah number within its surah, 1-based. */
export type AyahNumber = number & { readonly __brand: 'AyahNumber' };

export function surahNumber(value: number): SurahNumber {
  if (!Number.isInteger(value) || value < 1 || value > 114) {
    throw new RangeError(`Surah number must be an integer 1–114, received ${value}.`);
  }
  return value as SurahNumber;
}

export function ayahNumber(value: number): AyahNumber {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`Ayah number must be a positive integer, received ${value}.`);
  }
  return value as AyahNumber;
}

/** Identifies a translation edition, e.g. `en.sahih`. Never defaulted implicitly. */
export type TranslationId = string;

/** Identifies a reciter's audio edition, e.g. `ar.alafasy`. */
export type ReciterId = string;

export type SurahSummary = {
  readonly number: SurahNumber;
  /** Transliterated name, e.g. "Al-Kahf". */
  readonly name: string;
  /** Arabic name, e.g. "الكهف". Immutable, like all Arabic in this module. */
  readonly arabicName: string;
  /** English meaning, e.g. "The Cave". A name, not scripture. */
  readonly meaning: string;
  readonly ayahCount: number;
  readonly revelation: 'meccan' | 'medinan';
};

/**
 * One ayah's scripture text.
 *
 * Deliberately carries no translation field. Fetching a translation is a separate call
 * with an explicit `TranslationId`, so the two can never be conflated in storage or in a
 * render.
 */
export type AyahText = {
  readonly surah: SurahNumber;
  readonly ayah: AyahNumber;
  /** Uthmani script with harakat. Never transformed. */
  readonly arabic: string;
  /** Where this text came from. Required. */
  readonly source: ContentSource;
};

export type AyahTranslation = {
  readonly surah: SurahNumber;
  readonly ayah: AyahNumber;
  readonly translationId: TranslationId;
  readonly text: string;
  /** Translator attribution is mandatory — an unattributed rendering is not shippable. */
  readonly source: ContentSource;
};

export type TranslationEdition = {
  readonly id: TranslationId;
  readonly language: string;
  readonly name: string;
  readonly translator: string;
};

export type ReciterEdition = {
  readonly id: ReciterId;
  readonly name: string;
  readonly style?: string;
};

/**
 * One verse's recitation.
 *
 * ── It carries no text, and that is a rule rather than an omission ──────────
 * Recitation is the Arabic being recited. It is not a translation and it is not narration *of* a
 * translation — the approved API provides no such thing, and a field here that could hold a
 * transcript or a translated caption would invite a screen to label recitation as something it is
 * not. The verse reference says which ayah; the reader already holds that ayah's scripture and its
 * attributed translation as separate objects, which is the same separation `AyahText` and
 * `AyahTranslation` exist to enforce.
 */
export type AyahRecitation = {
  readonly surah: SurahNumber;
  readonly ayah: AyahNumber;
  readonly reciterId: ReciterId;
  /** An absolute `https:` URL on an audio host both sides of the boundary allow-list. */
  readonly url: string;
  readonly durationSeconds?: number;
};

/**
 * Where the user last stopped reading. The app's own data, not content.
 *
 * ── Why the surah's name and length are stored alongside the numbers ────────
 * The Continue-reading card has to say "Al-Kahf • verse 32 • 32 of 110" the instant it renders,
 * before any catalogue request could return. Two ways to get there were rejected:
 *
 *   • *Look the name up in the surah catalogue at render time.* That is a repository call on the
 *     critical path of the home screen, to render a string that cannot change.
 *   • *Look it up in the bundled fixture list.* Which is what the previous implementation did, and
 *     it meant a production screen was reading `mockSurahsForTest`.
 *
 * So the two facts are denormalised at write time, from whatever the catalogue said when the user
 * was actually reading — the same approach `Bookmark` already takes, for the same reason.
 *
 * `progress` is **derived**, never supplied: see `readingProgress`. It used to be a literal 0.55
 * written for every verse, which made the bar decorative.
 */
export type ReadingPosition = {
  readonly surah: SurahNumber;
  /** Transliterated surah name as the catalogue gave it, e.g. "Al-Kahf". */
  readonly surahName: string;
  readonly ayah: AyahNumber;
  /** The surah's total ayat, so progress can be stated as a fraction the user can check. */
  readonly ayahCount: number;
  /** 0–1 through the surah. Derived from `ayah` and `ayahCount`, never passed in. */
  readonly progress: number;
  readonly updatedAt: string;
};

/**
 * How far through a surah a given ayah is.
 *
 * Reaching verse *n* of *N* means *n* verses have been read, so the value is `n / N` — finishing the
 * last ayah gives 1. Guarded against a zero or missing count rather than dividing by it: a surah
 * whose length is unknown yields 0, which renders an empty bar, and an empty bar is an honest
 * statement about an unknown quantity where `NaN` is a rendering bug.
 */
export function readingProgress(ayah: number, ayahCount: number): number {
  if (!Number.isFinite(ayahCount) || ayahCount <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(1, ayah / ayahCount));
}

/** How a catalogue read should treat whatever the implementation has already stored. */
export type SurahCatalogueOptions = {
  /** Bypass every cache and re-read from the source, writing the result through on success. */
  readonly refresh?: boolean;
};

export type QuranContentRepository = {
  /**
   * Where everything this repository returns comes from.
   *
   * ── Why provenance is a property of the repository and not only of each item ──
   * `AyahText` and `AyahTranslation` already carry a `ContentSource`, which covers scripture. What
   * they do not cover is the *catalogue*: `listSurahs` returns surah metadata with no source field on
   * it, so the Qur'an screen had no way to describe what it was showing and hard-coded `MOCK_SOURCE`
   * instead — a screen asserting its own provenance, which stops being true the moment the repository
   * is swapped.
   *
   * Declaring it here means the swap carries the badge with it. A screen reads `quran.source` and is
   * correct under the mock, correct under the approved source, and impossible to leave stale.
   */
  readonly source: ContentSource;

  /**
   * The 114 surahs.
   *
   * ── Why this one method takes an option ─────────────────────────────────────
   * Because it is the only read whose answer is worth keeping across restarts, and a persisted
   * answer needs a way to be re-checked. Without `refresh`, a caller holding a stored catalogue has
   * no way to ask for a fresh one: every ordinary call is answered by the store, so `reload()` on
   * the screen would return the same stored rows forever and a background revalidation would be
   * impossible to express.
   *
   * `refresh: true` therefore means "skip every cache and ask the source", and it is the caller's
   * job to use it once rather than in a loop. Implementations that hold no cache may ignore it
   * entirely — the option is optional precisely so a repository without one still satisfies this
   * interface unchanged.
   */
  listSurahs(options?: SurahCatalogueOptions): Promise<FaithResult<readonly SurahSummary[]>>;

  getSurah(surah: SurahNumber): Promise<FaithResult<SurahSummary>>;

  /** Paginated because a long surah must not arrive as one 286-item payload. */
  listAyahs(surah: SurahNumber, page?: FaithPageRequest): Promise<FaithResult<FaithPage<AyahText>>>;

  /** `translationId` is required: there is no implicit default translation. */
  listTranslations(
    surah: SurahNumber,
    translationId: TranslationId,
    page?: FaithPageRequest,
  ): Promise<FaithResult<FaithPage<AyahTranslation>>>;

  /** The verse behind the Daily Ayah card. */
  getAyahOfTheDay(
    translationId: TranslationId,
  ): Promise<FaithResult<{ readonly text: AyahText; readonly translation: AyahTranslation }>>;

  searchTranslations(
    query: string,
    translationId: TranslationId,
    page?: FaithPageRequest,
  ): Promise<FaithResult<FaithPage<AyahTranslation>>>;

  availableTranslations(): Promise<FaithResult<readonly TranslationEdition[]>>;

  availableReciters(): Promise<FaithResult<readonly ReciterEdition[]>>;

  /**
   * Recitation audio for a surah, one entry per verse.
   *
   * ── Paginated, and paged alongside the verses ───────────────────────────────
   * The reader loads twenty verses at a time and this loads the matching twenty recitations, so the
   * play controls appear with the verses they belong to rather than after a request for all 286.
   *
   * `reciterId` is required for the same reason `translationId` is on `listTranslations`: there is no
   * implicit default reciter, and audio attributed to nobody is audio nobody can check.
   *
   * A verse whose audio could not be validated is **absent from the page** rather than present with
   * an empty URL — the reader draws a play control from the presence of an entry, so an entry that
   * cannot play would be a control that cannot work.
   */
  listRecitations(
    surah: SurahNumber,
    reciterId: ReciterId,
    page?: FaithPageRequest,
  ): Promise<FaithResult<FaithPage<AyahRecitation>>>;
};
