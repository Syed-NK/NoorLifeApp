import type { ContentSource, FaithPage, FaithPageRequest, FaithResult } from './faith-result';

/**
 * Supplications.
 *
 * Duas differ from Qur'an and Hadith in one way that matters to the type: many are
 * transliterated for readers who do not read Arabic script. Transliteration is a
 * rendering aid, never scripture, so it sits in its own optional field and the UI labels
 * it as such — it is never substituted for `arabic` when the Arabic fails to load.
 */

/** Grouping shown as the Duas screen's top-level list. */
export type DuaCategory = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly duaCount: number;
};

export type Dua = {
  readonly id: string;
  readonly categoryId: string;
  readonly title: string;
  /** Immutable Arabic with harakat. */
  readonly arabic: string;
  /** A reading aid only. Never rendered in place of `arabic`. */
  readonly transliteration?: string;
  readonly translation: string;
  /** Where the supplication is recorded, e.g. "Sahih Muslim 2723". */
  readonly reference: string;
  /** How many times it is traditionally repeated, where a count is narrated. */
  readonly repetitions?: number;
  readonly source: ContentSource;
};

export type DuaRepository = {
  listCategories(): Promise<FaithResult<readonly DuaCategory[]>>;

  listByCategory(categoryId: string, page?: FaithPageRequest): Promise<FaithResult<FaithPage<Dua>>>;

  getDua(id: string): Promise<FaithResult<Dua>>;

  search(query: string, page?: FaithPageRequest): Promise<FaithResult<FaithPage<Dua>>>;
};
