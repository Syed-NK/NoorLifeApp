import type { CounterLabel } from '../tasbih.repository';

/**
 * **What the Dhikr selector is allowed to offer, and why most of it is shut.**
 *
 * ── The rule this module exists to make unbreakable ─────────────────────────
 * A dhikr entry is a religious claim: it says NoorLife stands behind this Arabic, this
 * transliteration, this translation and this attribution. Five such entries once shipped with none
 * of that behind them and had to be removed. The type below is the guard against that happening
 * again by accident — a section cannot be *populated* without a provenance record, because the
 * populated case is the only one that carries entries at all, and nothing constructs it yet.
 *
 * ── Why the sections are modelled rather than hidden ────────────────────────
 * The obvious alternative is to ship only the section that works and add the others later. That
 * hides a real fact from the user: NoorLife intends to offer verified dhikr and cannot yet. A
 * section that is present and honestly shut says what is happening; an absent section says nothing,
 * and the day content arrives the navigation changes shape underneath people.
 *
 * It also keeps the shape of the screen fixed while the content question is settled elsewhere,
 * which is the whole point of building a shell now.
 */

/**
 * Why a section has no entries.
 *
 * Each value is a different answer to "will this ever work, and is it my fault?", which is the only
 * question a user actually has. They are not interchangeable and the screen words them differently.
 */
export type DhikrLockReason =
  /** Licensing or permission is outstanding with a named source. Nothing the user can do. */
  | 'permission-pending'
  /**
   * The provider has confirmed the use, and **NoorLife's own scholarly review has not happened yet**.
   *
   * ── Why this replaced `provider-unconfirmed` ────────────────────────────────
   * Because the provider is now confirmed and the old reason had become false. Quran Foundation has
   * given written permission for a Quran-derived Dhikr selector under NoorLife's existing Content
   * API access — no new scope, no fee, no production approval outstanding.
   *
   * What that grant explicitly does **not** supply is a religious judgement about which ayat are
   * appropriate as dhikr, what count is recommended, or what context belongs with them. That review
   * is NoorLife's obligation and is the only thing still holding this section shut. Keeping one
   * reason for both would have let "the vendor said yes" quietly read as "so we can ship it".
   */
  | 'awaiting-scholarly-review'
  /** A network-backed section with no connection right now. Retryable. */
  | 'offline'
  /** The provider answered, and answered badly. Distinct from offline: the device is fine. */
  | 'provider-unavailable';

export type DhikrSectionState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'locked'; readonly reason: DhikrLockReason }
  /** The only state that can carry religious text, and nothing builds it yet. */
  | { readonly kind: 'ready'; readonly entries: readonly DhikrEntry[] }
  /** Reachable, permitted, and genuinely holding nothing — an empty favourites list. */
  | { readonly kind: 'empty' };

/**
 * A verified dhikr.
 *
 * Every field is required, which is the point: there is no way to express "Arabic without a source"
 * or "translation without a translator". A future provider integration has to supply the whole
 * record or it cannot construct the type.
 */
export type DhikrEntry = {
  readonly id: string;
  readonly arabic: string;
  readonly transliteration: string;
  readonly translation: string;
  /** The canonical reference — a surah:ayah, or a collection and number. Never invented. */
  readonly reference: string;
  /** Who produced the translation being shown. Displayed with it, never dropped. */
  readonly translator: string;
  /** Where the record came from, for the audit trail. */
  readonly provenance: string;
  /** Only when the source itself states one. A target NoorLife chose is not a suggested target. */
  readonly suggestedTarget: number | null;
};

export type DhikrSectionId =
  | 'verified'
  /** Scholarly-reviewed Quran references. Shut until a reviewer approves one. */
  | 'quran'
  /**
   * The user's **own** Quran selections.
   *
   * A separate section from `quran` and never merged into it, because the two make different
   * claims: one says a qualified reviewer approved this reference for this purpose, and the other
   * says somebody chose a verse. Both render the same publisher scripture, which is precisely why
   * they must not sit under one heading — a user who cannot tell them apart will reasonably assume
   * NoorLife vouched for both.
   */
  | 'selections'
  | 'personal'
  | 'favourites'
  | 'recent';

export type DhikrSection = {
  readonly id: DhikrSectionId;
  readonly title: string;
  /** One line under the title, always true of the section whatever state it is in. */
  readonly summary: string;
  readonly state: DhikrSectionState;
};

/**
 * The catalogue as it stands for this release.
 *
 * ── Why `verified` is `permission-pending` and not merely empty ─────────────
 * Because those are different claims. "Empty" says NoorLife looked and there was nothing; the truth
 * is that the text exists, is well known, and NoorLife does not yet have permission to redistribute
 * it. Requests are outstanding with Sunnah.com and Darussalam, and the screen says so — including
 * that no content has been copied in the meantime.
 *
 * ── Why `quran` is `awaiting-scholarly-review` and not populated ────────────
 * The Quran Foundation boundary exists, is authenticated, and — as of 2026-08 — is **permitted** for
 * exactly this use in writing. What does not exist is a reference list from a qualified content
 * authority. Deciding which ayat constitute dhikr is editorial religious work, and a developer
 * picking them from memory is precisely the failure that produced the five removed presets. So the
 * whole architecture is built (`data/dhikr/`), the gate is enforced, and the list is empty.
 *
 * ── The section's state comes from the caller now ───────────────────────────
 * `quranState` is a parameter rather than a constant, because whether this section has content is a
 * runtime question about an approved catalogue and a live fetch, not a fact that can be written
 * down here. It defaults to the shut state so a caller that has not wired the resolver cannot
 * accidentally present an open one.
 */
export function dhikrCatalogue(input: {
  readonly personal: readonly CounterLabel[];
  readonly favourites: readonly string[];
  readonly recent: readonly string[];
  readonly quranState?: DhikrSectionState;
  /** How many Quran selections the user has saved. Decides whether that section is empty. */
  readonly selectionCount?: number;
}): readonly DhikrSection[] {
  return [
    /*
      Quran-derived first. It is the section carrying content NoorLife vouches for, and the ordering
      is the strongest available signal of which list is which — personal counters must never be the
      first thing a user reads under a heading about dhikr.
    */
    {
      id: 'quran',
      title: 'Quran-derived Dhikr',
      summary:
        'Scholarly-reviewed references, resolved live from Quran Foundation with the translator credited',
      state: input.quranState ?? { kind: 'locked', reason: 'awaiting-scholarly-review' },
    },
    /*
      The user's own selections come second: after the section NoorLife vouches for and before the
      ones it does not. The ordering is the strongest available signal of which list is which, and
      putting a private choice first under a heading about dhikr is the thing this screen must not do.
    */
    {
      id: 'selections',
      title: 'Your Quran selections',
      summary: 'Verses you chose yourself. NoorLife makes no religious claim about them.',
      state:
        (input.selectionCount ?? 0) === 0
          ? { kind: 'empty' }
          : { kind: 'ready', entries: [] as readonly DhikrEntry[] },
    },
    {
      id: 'verified',
      title: 'Verified Dhikr',
      summary: 'Sourced text with a named reference and a licensed translation',
      state: { kind: 'locked', reason: 'permission-pending' },
    },
    {
      id: 'personal',
      title: 'Personal counters',
      summary: 'Your own private labels. NoorLife makes no claim about these.',
      state:
        input.personal.length === 0
          ? { kind: 'empty' }
          : { kind: 'ready', entries: [] as readonly DhikrEntry[] },
    },
    {
      id: 'favourites',
      title: 'Favourites',
      summary: 'Counters you have starred',
      state: input.favourites.length === 0 ? { kind: 'empty' } : { kind: 'ready', entries: [] },
    },
    {
      id: 'recent',
      title: 'Recent',
      summary: 'Counters you used lately',
      state: input.recent.length === 0 ? { kind: 'empty' } : { kind: 'ready', entries: [] },
    },
  ];
}

/**
 * What a locked section says, in the user's terms.
 *
 * Exhaustive over the union so a new lock reason is a compile error rather than a section that
 * silently explains nothing — the same construction the Qibla fallback banner uses, for the same
 * reason.
 */
export function lockMessage(reason: DhikrLockReason): { title: string; body: string } {
  switch (reason) {
    case 'permission-pending':
      return {
        title: 'Not available yet',
        body: 'NoorLife has asked the rights holders for permission to include this text. Until that is granted, nothing is shown here — no copied text, and no placeholders.',
      };
    case 'awaiting-scholarly-review':
      return {
        title: 'Awaiting scholarly review',
        body: 'Quran Foundation has given permission for this, and NoorLife will not choose which verses count as dhikr on its own. Nothing appears here until each reference has been reviewed and approved by a qualified reviewer.',
      };
    case 'offline':
      return {
        title: 'You are offline',
        body: 'This section is fetched when you have a connection. Nothing is stored on the device.',
      };
    case 'provider-unavailable':
      return {
        title: 'Provider unavailable',
        body: 'The provider did not answer. Your connection looks fine, so this is at their end — try again shortly.',
      };
  }
}

/**
 * The category filters.
 *
 * Listed because the brief names them, and every one of them is Hadith-derived apart from the
 * Quranic entry — so all of them resolve to a locked section today. A filter that appears to hold
 * content it cannot show would be worse than one that is plainly shut, so selecting any of these
 * lands on the same honest lock state rather than an empty list implying "none matched".
 */
export const DHIKR_CATEGORIES = [
  { id: 'quranic', label: 'Quranic', section: 'quran' },
  { id: 'selections', label: 'My selections', section: 'selections' },
  { id: 'morning-evening', label: 'Morning & Evening', section: 'verified' },
  { id: 'after-prayer', label: 'After Prayer', section: 'verified' },
  { id: 'praise', label: 'Praise', section: 'verified' },
  { id: 'forgiveness', label: 'Forgiveness', section: 'verified' },
  { id: 'protection', label: 'Protection', section: 'verified' },
  { id: 'personal', label: 'Personal', section: 'personal' },
] as const satisfies readonly {
  readonly id: string;
  readonly label: string;
  readonly section: DhikrSectionId;
}[];

export type DhikrCategoryId = (typeof DHIKR_CATEGORIES)[number]['id'];

/** Case- and whitespace-insensitive match over a personal label's own text. */
export function matchesQuery(label: CounterLabel, query: string): boolean {
  const needle = query.trim().toLowerCase();
  return needle.length === 0 || label.name.toLowerCase().includes(needle);
}
