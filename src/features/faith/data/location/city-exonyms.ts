/**
 * The few English names that the bundled catalogue does not already store.
 *
 * ── Why this list is four entries and not fifty ─────────────────────────────
 * The first draft had thirty — Munich/München, Vienna/Wien, Rome/Roma, Prague/Praha and so on — and
 * the guard test below rejected twenty-five of them as dead. The reason is worth recording, because
 * it is the opposite of what the draft assumed: GeoNames' `name` column is already
 * **English-preferred**. The catalogue stores *Munich*, *Vienna*, *Rome*, *Prague*, *Florence* and
 * *The Hague* under exactly those spellings, so mapping them to their local forms mapped them to
 * strings the data does not contain.
 *
 * What survives is the genuine remainder: the handful of cities GeoNames records under a local or
 * transliterated name that a great many English speakers would not type.
 *
 * ── The one this app cannot get wrong ───────────────────────────────────────
 * Mecca. The catalogue stores *Makkah*, which is correct and is what should be rendered, but a
 * prayer app that answers "no results" for the word "Mecca" has failed at its own subject.
 *
 * ── What this is not ────────────────────────────────────────────────────────
 * Not a translation layer and not a general alias system. Every value maps to a name the catalogue
 * actually contains — asserted, so an entry cannot quietly rot into a wrong answer — and a mapping
 * only ever *widens* a search. It never replaces the typed query, so somebody who really did mean
 * the city named Medina in Ohio still finds it.
 *
 * ── Why not harvest GeoNames' `alternatenames` column instead ───────────────
 * It was tried and measured. `scripts/import-city-catalogue.mjs` records the result: the column has
 * no ordering by usefulness, so any automatic sample is arbitrary, and the arbitrary sample included
 * Kisumu carrying the alias `florence`. Offering a Kenyan city for a correctly-spelled "Florence" is
 * the same class of failure as a wrong coordinate — confident, and invisible to the person acting on
 * it. Measured cost of carrying them: 0.81 MB, 27% of the asset.
 */

/**
 * Normalised exonym → normalised endonym, both already in `normalizeCityQuery` form.
 *
 * Pre-normalised so a lookup is a map read rather than a fold per keystroke. The guard test asserts
 * both sides are already in that form, so an entry typed with an accent cannot silently never match.
 */
export const CITY_EXONYMS: Readonly<Record<string, string>> = {
  /** The catalogue stores `Makkah`. */
  mecca: 'makkah',
  /**
   * The catalogue stores `Madinah` — and also several unrelated cities genuinely named *Medina*,
   * which is why this widens rather than redirects.
   */
  medina: 'madinah',
  /** The catalogue stores `Köln`, one of the few German cities it does not anglicise. */
  cologne: 'koln',
  /** The catalogue stores `Sevilla`. */
  seville: 'sevilla',
};

/**
 * The queries to search for, given the one the user typed.
 *
 * Always includes the original, so an exonym match widens the search rather than redirecting it.
 * Returns a single entry for the overwhelming majority of queries, which is the case worth keeping
 * cheap — it runs once per keystroke.
 */
export function expandQuery(normalizedQuery: string): readonly string[] {
  const endonym = CITY_EXONYMS[normalizedQuery];
  return endonym === undefined || endonym === normalizedQuery
    ? [normalizedQuery]
    : [normalizedQuery, endonym];
}
