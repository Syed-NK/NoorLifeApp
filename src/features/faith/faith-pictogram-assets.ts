import type { ImageSourcePropType } from 'react-native';

import type { FaithPictogramSlot } from './components/faith-locked-library';

/**
 * The sixteen dimensional Faith pictogram slots, as one registry.
 *
 * ── Static `require` only ───────────────────────────────────────────────────
 * Metro resolves `require` at build time. A template string, a lookup by variable or a dynamic
 * import silently resolves to nothing in a release bundle, which is precisely how an icon-font
 * fallback gets reintroduced by accident — `faith-submenu-assets.ts` records the same rule for the
 * eight assets that already ship. Every path below is a literal.
 *
 * ── Three states, and why the third exists ──────────────────────────────────
 * `installed` and `awaiting-artwork` were enough while the only question was whether artwork had
 * arrived. P3 raised a different one: the bell exists, is approved, and **must not render**, because
 * the Prayer reminders row it would sit beside persists a preference and schedules nothing — no
 * permission request, no local notification, no background handler, no rescheduling after restart.
 *
 * With two states that slot had no honest home. `installed` would draw the bell and make an
 * unfinished control look finished; `awaiting-artwork` would be false, and would fail the on-disk
 * check the moment the PNG landed — with the one-keystroke fix being to install it. So the registry
 * would have applied pressure in exactly the wrong direction at exactly the wrong moment.
 *
 * `held` says the true thing: delivered, registered, deliberately not rendered, and here is why.
 *
 * ── What `held` deliberately does not have ──────────────────────────────────
 * **No `require`.** A held asset is known to the registry by *filename* — enough for the on-disk
 * audit to recognise it as accounted for — and is not pulled into the bundle. There is therefore no
 * source object in existence for a render path to reach, which is a stronger guarantee than a rule
 * saying not to use one.
 */

/** Slot identifiers, in the brief's own IDs. `d3` reuses H2's image — see `file` below. */
export type FaithPictogramId =
  | 'h1'
  | 'h2'
  | 'h3'
  | 'd1'
  | 'd2'
  | 'd3'
  | 's1'
  | 'p1'
  | 'p2-fajr'
  | 'p2-sunrise'
  | 'p2-dhuhr'
  | 'p2-asr'
  | 'p2-maghrib'
  | 'p2-isha'
  | 'p3'
  | 'p4';

export type FaithPictogramAsset =
  /** Artwork is registered, bundled and rendered. */
  | { readonly status: 'installed'; readonly source: ImageSourcePropType }
  /**
   * Artwork is delivered and registered, and must not render.
   *
   * Carries no `source`, so there is nothing to render even by mistake. `heldReason` is required and
   * must be non-empty: a slot may only be withheld for a stated reason, which is what stops `held`
   * becoming a quiet way to silence the on-disk audit.
   */
  | {
      readonly status: 'held';
      readonly heldReason: string;
      readonly developmentFallback: FaithPictogramSlot;
    }
  /** Artwork has not been delivered. */
  | {
      readonly status: 'awaiting-artwork';
      readonly developmentFallback: FaithPictogramSlot;
    };

export type FaithPictogramEntry = {
  readonly id: FaithPictogramId;
  /** Exact filename in `assets/images/modules/faith/pictograms/`. */
  readonly file: string;
  /** The approved subject, in the words of the asset brief. */
  readonly subject: string;
  /** The dp box the slot renders in, for the acceptance pass. */
  readonly renderedAtDp: number;
  readonly asset: FaithPictogramAsset;
};

/**
 * Every slot, in brief order: Hadith, Duas, shared, Prayer.
 *
 * Two slots share one file. `d3` and `h2` are the same subject — an open cream book with an
 * emerald/gold ribbon — so D3 requires H2's image rather than a second drawing of one idea three
 * taps apart in the same module.
 */
export const faithPictograms: readonly FaithPictogramEntry[] = [
  {
    id: 'h1',
    file: 'h1-hadith-collections.png',
    subject: 'Stacked bound emerald volumes with gilt tooling',
    renderedAtDp: 40,
    asset: {
      status: 'installed',
      source:
        require('@assets/images/modules/faith/pictograms/h1-hadith-collections.png') as ImageSourcePropType,
    },
  },
  {
    id: 'h2',
    file: 'h2-bookmarked-book.png',
    subject: 'Open cream book with an emerald/gold ribbon bookmark',
    renderedAtDp: 40,
    asset: {
      status: 'installed',
      source:
        require('@assets/images/modules/faith/pictograms/h2-bookmarked-book.png') as ImageSourcePropType,
    },
  },
  {
    id: 'h3',
    file: 'h3-reading-history.png',
    subject: 'Closed emerald volume with a gold pocket watch',
    renderedAtDp: 40,
    asset: {
      status: 'installed',
      source:
        require('@assets/images/modules/faith/pictograms/h3-reading-history.png') as ImageSourcePropType,
    },
  },
  {
    id: 'd1',
    file: 'd1-morning-evening.png',
    subject: 'Sunrise over jade prayer beads with a restrained gold tassel',
    renderedAtDp: 40,
    asset: {
      status: 'installed',
      source:
        require('@assets/images/modules/faith/pictograms/d1-morning-evening.png') as ImageSourcePropType,
    },
  },
  {
    id: 'd2',
    file: 'd2-everyday-moments.png',
    subject: 'Dimensional emerald home with a crescent finial',
    renderedAtDp: 40,
    asset: {
      status: 'installed',
      source:
        require('@assets/images/modules/faith/pictograms/d2-everyday-moments.png') as ImageSourcePropType,
    },
  },
  {
    id: 'd3',
    /*
      Deliberately H2's file, and deliberately H2's `require`. Metro dedupes identical literal paths,
      so the image is bundled once and both slots hand the renderer the same source object — which is
      what a test can assert to prove the reuse is real rather than two copies that happen to look
      alike today.
    */
    file: 'h2-bookmarked-book.png',
    subject: 'Open cream book with an emerald/gold ribbon bookmark — the same image as H2',
    renderedAtDp: 40,
    asset: {
      status: 'installed',
      source:
        require('@assets/images/modules/faith/pictograms/h2-bookmarked-book.png') as ImageSourcePropType,
    },
  },
  {
    id: 's1',
    file: 's1-verified-shield.png',
    subject: 'Emerald shield with a gold rim and a cream check',
    renderedAtDp: 38,
    asset: {
      status: 'installed',
      source:
        require('@assets/images/modules/faith/pictograms/s1-verified-shield.png') as ImageSourcePropType,
    },
  },
  {
    id: 'p1',
    file: 'p1-location-mosque-pin.png',
    subject: 'Mosque inside a gold-rimmed map pin',
    renderedAtDp: 28,
    asset: {
      status: 'installed',
      source:
        require('@assets/images/modules/faith/pictograms/p1-location-mosque-pin.png') as ImageSourcePropType,
    },
  },
  {
    id: 'p2-fajr',
    file: 'p2-fajr.png',
    subject: 'Fajr crescent',
    renderedAtDp: 22,
    asset: {
      status: 'installed',
      source: require('@assets/images/modules/faith/pictograms/p2-fajr.png') as ImageSourcePropType,
    },
  },
  {
    id: 'p2-sunrise',
    file: 'p2-sunrise.png',
    // The arc labels it a time marker in words; the image makes no claim either way.
    subject: 'Sunrise — a time marker, not a prayer',
    renderedAtDp: 22,
    asset: {
      status: 'installed',
      source:
        require('@assets/images/modules/faith/pictograms/p2-sunrise.png') as ImageSourcePropType,
    },
  },
  {
    id: 'p2-dhuhr',
    file: 'p2-dhuhr.png',
    subject: 'Dhuhr prayer rug',
    renderedAtDp: 22,
    asset: {
      status: 'installed',
      source:
        require('@assets/images/modules/faith/pictograms/p2-dhuhr.png') as ImageSourcePropType,
    },
  },
  {
    id: 'p2-asr',
    file: 'p2-asr.png',
    subject: 'Asr sun',
    renderedAtDp: 22,
    asset: {
      status: 'installed',
      source: require('@assets/images/modules/faith/pictograms/p2-asr.png') as ImageSourcePropType,
    },
  },
  {
    id: 'p2-maghrib',
    file: 'p2-maghrib.png',
    subject: 'Maghrib mosque at sunset',
    renderedAtDp: 22,
    asset: {
      status: 'installed',
      source:
        require('@assets/images/modules/faith/pictograms/p2-maghrib.png') as ImageSourcePropType,
    },
  },
  {
    id: 'p2-isha',
    file: 'p2-isha.png',
    subject: 'Isha crescent and stars',
    renderedAtDp: 22,
    asset: {
      status: 'installed',
      source: require('@assets/images/modules/faith/pictograms/p2-isha.png') as ImageSourcePropType,
    },
  },
  {
    id: 'p3',
    file: 'p3-reminder-bell.png',
    subject: 'Dimensional gold reminder bell',
    renderedAtDp: 20,
    /*
      ── The one held slot ─────────────────────────────────────────────────────
      No `require`, so the bell is not in the bundle and no render path can reach it. The row keeps
      its restrained vector and its "scheduling arrives with notification support" banner.

      This is a statement about the *feature*, not the artwork: the asset passed every acceptance
      check. It renders when reminders actually remind somebody.
    */
    asset: {
      status: 'held',
      heldReason:
        'Prayer reminders persist a preference and schedule nothing — no permission request, no ' +
        'local notification, no background handler, no rescheduling after restart or a timezone ' +
        'change, and no delivery verification. A dimensional gold bell beside that switch would ' +
        'assert that reminders work, and somebody would miss a prayer trusting it. Held until ' +
        'notification delivery is built and separately approved.',
      developmentFallback: { kind: 'vector', icon: 'notification' },
    },
  },
  {
    id: 'p4',
    file: 'p4-calculation-gear.png',
    subject: 'Dimensional emerald-and-gold calculation gear',
    renderedAtDp: 20,
    /*
      Installed, and the contrast with P3 is the whole rule: Calculation settings navigates to
      `/faith/preferences`, which owns the value the row displays. The artwork upgrades a control
      that already does what it appears to do.
    */
    asset: {
      status: 'installed',
      source:
        require('@assets/images/modules/faith/pictograms/p4-calculation-gear.png') as ImageSourcePropType,
    },
  },
];

/** The directory every entry's `file` is relative to, as one string for the tests and the docs. */
export const FAITH_PICTOGRAM_DIR = 'assets/images/modules/faith/pictograms';

/** Resolves one entry. Throws rather than returning a fallback — an unknown id is a typo, not a state. */
export function getFaithPictogram(id: FaithPictogramId): FaithPictogramEntry {
  const entry = faithPictograms.find((item) => item.id === id);
  if (entry === undefined) {
    throw new Error(`No Faith pictogram registered for "${id}".`);
  }
  return entry;
}

/**
 * A slot as the rendering components consume it.
 *
 * The one place a non-installed slot is resolved, so there is a single line to look at when asking
 * what a screen actually draws. `held` and `awaiting-artwork` both yield the restrained vector —
 * they differ in *why*, which is the audit's business, not the renderer's.
 */
export function faithPictogramSlot(id: FaithPictogramId): FaithPictogramSlot {
  const { asset } = getFaithPictogram(id);
  return asset.status === 'installed'
    ? { kind: 'png', source: asset.source }
    : asset.developmentFallback;
}

/**
 * Slots still waiting for artwork. **Excludes held slots**, which are not waiting for anything.
 *
 * Empty is the end state, and it is reachable with P3 held — which is the point of the third state.
 */
export function pendingFaithPictograms(): readonly FaithPictogramEntry[] {
  return faithPictograms.filter((entry) => entry.asset.status === 'awaiting-artwork');
}

/** Slots whose artwork exists and is deliberately not rendered. Reported separately by the audit. */
export function heldFaithPictograms(): readonly FaithPictogramEntry[] {
  return faithPictograms.filter((entry) => entry.asset.status === 'held');
}

/** Every distinct filename the directory should hold. Sixteen slots, fifteen files. */
export const expectedFaithPictogramFiles: readonly string[] = [
  ...new Set(faithPictograms.map((entry) => entry.file)),
];
