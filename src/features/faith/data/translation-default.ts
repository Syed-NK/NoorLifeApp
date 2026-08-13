import { hasData } from './faith-result';
import {
  surahNumber,
  type QuranContentRepository,
  type TranslationEdition,
} from './quran-content.repository';
import {
  DEFAULT_TRANSLATION_LANGUAGE,
  PREFERRED_DEFAULT_TRANSLATORS,
  RETIRED_TRANSLATION_IDS,
  type TranslationChoice,
} from '../storage/faith-preferences';

/**
 * Choosing NoorLife's default translation, from the live catalogue, with a check that it works.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Why this module exists at all ───────────────────────────────────────────
 * The default used to be the constant `'131'`, taken from the one translation `resource_id` the
 * vendor's specification names by example. Being in the specification turned out to say nothing
 * about whether the edition is enabled for a given project: on NoorLife's credentials `131` answers
 * `200` with **zero rows and no attribution**. The reader can only render that as "this surah has no
 * translation" — a statement about scripture rather than about a misconfigured default.
 *
 * The lesson is narrow and worth stating: **catalogue membership is not availability.** An edition
 * can be listed, be selectable, and still return nothing. So a default is not accepted here until a
 * real verse request has come back with a real translated row and a credit to put above it.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * The verse used to prove an edition actually renders.
 *
 * Al-Fatihah 1:1 — the shortest possible request against the shortest surah, present in every
 * edition that exists at all, and one page of one row. A longer surah would cost more for no extra
 * confidence, and a rarely-translated verse would fail editions that are perfectly fine.
 */
const PROBE_SURAH = 1;
const PROBE_PAGE_SIZE = 1;

/** How many candidate editions are probed before the resolver gives up. */
const MAX_PROBES = 5;

export type TranslationDefaultOutcome =
  | { readonly kind: 'resolved'; readonly choice: TranslationChoice }
  /** The catalogue could not be read. Distinct from "read, and nothing in it works". */
  | { readonly kind: 'catalogue-unavailable' }
  /** The catalogue answered and no English edition survived validation. */
  | { readonly kind: 'no-valid-english' };

/** Case-insensitive language match against the catalogue's own `language_name`. */
export function isEnglish(edition: TranslationEdition): boolean {
  return edition.language.trim().toLowerCase() === DEFAULT_TRANSLATION_LANGUAGE;
}

/**
 * Whether this edition is by one of the preferred translators.
 *
 * Substring rather than equality because the vendor's `author_name` spelling is the vendor's and has
 * varied — "M.A.S. Abdel Haleem", "Abdul Haleem". An exact match would silently fall through to the
 * fallback and nobody would know the preference had stopped working.
 */
export function isPreferredTranslator(edition: TranslationEdition): boolean {
  const translator = edition.translator.trim().toLowerCase();
  const name = edition.name.trim().toLowerCase();
  return PREFERRED_DEFAULT_TRANSLATORS.some(
    (preferred) => translator.includes(preferred) || name.includes(preferred),
  );
}

/**
 * The English editions worth probing, best candidate first.
 *
 * Retired ids are excluded before anything is requested — probing `131` to rediscover that it
 * returns nothing would be a vendor request spent confirming something already known.
 */
export function rankEnglishCandidates(
  editions: readonly TranslationEdition[],
): readonly TranslationEdition[] {
  const english = dedupeById(
    editions.filter(isEnglish).filter((edition) => !RETIRED_TRANSLATION_IDS.has(edition.id)),
  );

  const preferred = english.filter(isPreferredTranslator);
  const rest = english
    .filter((edition) => !isPreferredTranslator(edition))
    /**
     * Alphabetical, so the fallback is deterministic.
     *
     * "The first valid English translation returned by the catalogue" would make NoorLife's default
     * depend on the vendor's row order, which is not something the vendor promises to keep stable —
     * two installs on the same day could disagree about what "the default" is.
     */
    .sort((a, b) => a.name.localeCompare(b.name));

  return [...preferred, ...rest];
}

/**
 * One entry per resource id, keeping the first occurrence.
 *
 * ── Not hypothetical: the live catalogue repeats ids ────────────────────────
 * A verification run against the deployed function listed resource `85` **twice**. Whatever the
 * vendor's reason — a re-published edition, two rows differing in a field this contract does not
 * read — the effect here would be that the same edition consumed two of the five probe slots, and
 * failed twice for the same reason, pushing a genuinely different candidate out of the budget
 * entirely.
 *
 * First occurrence wins rather than last, so the ranking above stays meaningful: a preferred
 * translator that sorted to the front is not displaced by a duplicate of itself further down.
 */
function dedupeById(editions: readonly TranslationEdition[]): readonly TranslationEdition[] {
  const seen = new Set<string>();
  const unique: TranslationEdition[] = [];
  for (const edition of editions) {
    if (seen.has(edition.id)) {
      continue;
    }
    seen.add(edition.id);
    unique.push(edition);
  }
  return unique;
}

function toChoice(edition: TranslationEdition): TranslationChoice {
  return {
    id: edition.id,
    language: edition.language,
    name: edition.name,
    translator: edition.translator,
  };
}

/**
 * Whether an edition genuinely renders: at least one row, with a credit.
 *
 * ── All three conditions are load-bearing ───────────────────────────────────
 *   • **`hasData`** — anything other than a successful page is a no.
 *   • **At least one row.** This is the `131` case. An empty page is a legitimate answer at the end
 *     of a surah, but for *page one of Al-Fatihah* it means the edition has no content here, and the
 *     brief is explicit that this is an unavailable edition rather than a successful empty result.
 *   • **An attribution.** Fail closed, matching the server: an edition NoorLife cannot credit is one
 *     it must never render beside scripture, so it is not a default it may choose.
 */
export async function validateTranslation(
  quran: QuranContentRepository,
  edition: TranslationEdition,
): Promise<boolean> {
  const page = await settled(() =>
    quran.listTranslations(surahNumber(PROBE_SURAH), edition.id, { limit: PROBE_PAGE_SIZE }),
  );

  if (page === null || !hasData(page)) {
    return false;
  }
  const first = page.data.items[0];
  if (first === undefined || first.text.trim().length === 0) {
    return false;
  }
  /**
   * The credit, read from the row's own source rather than from the catalogue entry.
   *
   * The catalogue says who *should* be credited; the response says who the server was willing to
   * credit after its own fail-closed check. Only the second one proves the reader will have a name
   * to show, which is the thing being validated.
   */
  const attribution = first.source.attribution;
  return typeof attribution === 'string' && attribution.trim().length > 0;
}

/**
 * Resolves the default translation: live catalogue, English, preferred translator, validated.
 *
 * Probing is bounded to `MAX_PROBES` candidates. An unbounded loop over a catalogue that has gone
 * wrong would issue one vendor request per edition — hundreds — on a path that runs at app start.
 */
/**
 * Runs a repository call and turns a **thrown** failure into `null`.
 *
 * ── Why this is not paranoia ────────────────────────────────────────────────
 * Every repository in this module is contracted to answer with a `FaithResult` rather than to throw,
 * and the approved adapter does — once it has a configured Supabase client. Before that, and on any
 * unanticipated fault, the call throws. Everywhere else in Faith that does not matter, because every
 * other repository call goes through `useFaithResource`, which catches.
 *
 * This module is the exception: it is called from an effect and awaited directly, so an escaping
 * rejection is unhandled and takes the tree down. Resolution runs at app start, which is the worst
 * possible moment for that — so a throw is treated as exactly what it is operationally, a catalogue
 * that could not be read.
 */
async function settled<T>(call: () => Promise<T>): Promise<T | null> {
  try {
    return await call();
  } catch {
    // Nothing about the failure is captured. It can carry a vendor message, and this module has no
    // logger by design — see the note in `normalize.ts` for the same rule on the server side.
    return null;
  }
}

export async function resolveDefaultTranslation(
  quran: QuranContentRepository,
): Promise<TranslationDefaultOutcome> {
  const catalogue = await settled(() => quran.availableTranslations());
  if (catalogue === null || !hasData(catalogue)) {
    return { kind: 'catalogue-unavailable' };
  }

  const candidates = rankEnglishCandidates(catalogue.data).slice(0, MAX_PROBES);
  for (const edition of candidates) {
    if (await validateTranslation(quran, edition)) {
      return { kind: 'resolved', choice: toChoice(edition) };
    }
  }
  return { kind: 'no-valid-english' };
}

/**
 * Whether a stored choice is still offered by the catalogue.
 *
 * Membership only — deliberately *not* a re-probe. This runs whenever a selection screen opens, and
 * spending a verse request per open to re-prove an edition the user is already reading successfully
 * would be load with no purpose. An edition that has genuinely stopped rendering surfaces where it
 * matters: the reader already reports `edition-unavailable` and offers another choice.
 */
export function isStillOffered(
  choice: TranslationChoice,
  editions: readonly TranslationEdition[],
): boolean {
  return editions.some((edition) => edition.id === choice.id);
}
