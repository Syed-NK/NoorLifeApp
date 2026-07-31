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

/** Where the user last stopped reading. The app's own data, not content. */
export type ReadingPosition = {
  readonly surah: SurahNumber;
  readonly ayah: AyahNumber;
  /** 0–1 through the surah, for the Continue-Quran progress bar. */
  readonly progress: number;
  readonly updatedAt: string;
};

export type QuranContentRepository = {
  listSurahs(): Promise<FaithResult<readonly SurahSummary[]>>;

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
};
