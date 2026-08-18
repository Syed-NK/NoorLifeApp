import type { WireEdition } from '../quran-foundation/quran-foundation.contract';
import type { TranslationAttribution } from '../../storage/faith-sync-rows';

/**
 * Who translated the text in a generation, resolved from the publisher's own catalogue.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── The defect this exists to fix ──────────────────────────────────────────
 * The published generation on the device carries **6,236 valid translation rows and
 * `attribution: null`**. The cause was one line in the orchestrator:
 *
 *     staged.translations = { attribution: previous?.translations.attribution ?? null, rows };
 *
 * Attribution was only ever *carried forward* from the previous generation and **never sourced from
 * anywhere**. On bootstrap there is no previous generation, so it started null — and every later
 * generation faithfully inherited the null. It was not a vendor omission and not a serialisation
 * bug; the value was simply never fetched.
 *
 * That matters beyond tidiness: a translation shown without its translator is a translation
 * presented as if it were the text itself, and the licence requires the translator and Quran
 * Foundation to remain visible wherever the translation appears.
 *
 * ── Where it legitimately comes from ───────────────────────────────────────
 * `list_translation_resources`, which returns `WireEdition { id, language, name, translator }` — the
 * publisher's own catalogue. Resolution is by **exact resource id**. Nothing here infers a
 * translator from a number, and nothing hard-codes one: if the catalogue does not name resource 85,
 * this fails closed and no translation is published.
 *
 * The previously verified identity for resource 85 is edition *M.A.S. Abdel Haleem*, translator
 * *Abdul Haleem*, English. That is what the catalogue is **expected** to say — it is not a default,
 * and this module will not substitute it when the catalogue is silent.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export type AttributionResolution =
  | { readonly kind: 'resolved'; readonly attribution: TranslationAttribution }
  /** The catalogue does not name this resource at all. */
  | { readonly kind: 'absent' }
  /** Two catalogue rows claim the same id with different metadata. */
  | { readonly kind: 'conflicting' }
  /** Named, but without a usable translator or edition name. */
  | { readonly kind: 'incomplete' }
  /** Named, but not in the language this resource is published in. */
  | { readonly kind: 'wrong-language' };

function normalise(value: string | undefined | null): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Whether two catalogue rows are the same claim.
 *
 * Compared on the **trimmed** fields rather than by identity, so a catalogue that repeats a row —
 * which is a normal thing for a paginated list to do — is a duplicate rather than a conflict. Case
 * is preserved: "Abdul Haleem" and "abdul haleem" are *not* silently merged, because deciding which
 * casing to display would be this module inventing an answer.
 */
function sameClaim(left: WireEdition, right: WireEdition): boolean {
  return (
    normalise(left.name) === normalise(right.name) &&
    normalise(left.translator) === normalise(right.translator) &&
    normalise(left.language) === normalise(right.language)
  );
}

/**
 * Resolves attribution for one resource id, or says exactly why it could not.
 *
 * ── Every outcome is a refusal except one ──────────────────────────────────
 * Deliberately. This value gates whether translation rows may be published at all, so "probably
 * Abdul Haleem" is not an acceptable answer — the caller must be able to distinguish *silent
 * catalogue*, *contradictory catalogue* and *catalogue naming the wrong language*, because those
 * are three different faults with three different fixes.
 */
export function resolveTranslationAttribution(
  editions: readonly WireEdition[],
  resourceId: number,
  expectedLanguage: string,
): AttributionResolution {
  const matches = editions.filter((edition) => Number(edition.id) === resourceId);
  if (matches.length === 0) {
    return { kind: 'absent' };
  }

  const first = matches[0] as WireEdition;
  /*
    Duplicates are tolerated only when they agree. A catalogue that says resource 85 is two
    different translations is not something to pick a winner from — choosing the first would make
    the displayed translator depend on response ordering.
  */
  if (!matches.every((edition) => sameClaim(edition, first))) {
    return { kind: 'conflicting' };
  }

  const name = normalise(first.name);
  const translator = normalise(first.translator);
  if (name.length === 0 || translator.length === 0) {
    return { kind: 'incomplete' };
  }

  if (normalise(first.language).toLowerCase() !== expectedLanguage.trim().toLowerCase()) {
    return { kind: 'wrong-language' };
  }

  return { kind: 'resolved', attribution: { resourceId, name, translator } };
}

/**
 * Whether an attribution may be published beside translation rows.
 *
 * The single predicate the publication path consults, so "has a translator" cannot be re-derived
 * slightly differently somewhere else. `resourceId` must match the rows it is being bound to —
 * attribution from one resource attached to another's text is a misattribution, which is worse than
 * no attribution at all.
 */
export function isPublishableAttribution(
  attribution: TranslationAttribution | null,
  resourceId: number,
): attribution is TranslationAttribution {
  return (
    attribution !== null &&
    attribution.resourceId === resourceId &&
    normalise(attribution.name).length > 0 &&
    normalise(attribution.translator).length > 0
  );
}
