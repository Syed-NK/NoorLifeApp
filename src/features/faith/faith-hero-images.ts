import type { ImageSourcePropType } from 'react-native';

/**
 * The eight complete Faith hero cards, and what each one is allowed to say.
 *
 * ── What these are ─────────────────────────────────────────────────────────
 * Each file is the approved selected-B hero card in full: cinematic background, foreground object, and
 * the eyebrow and heading **baked into the pixels**. The gold button was removed from the sources before
 * they were supplied, leaving a cleared region in the lower left.
 *
 * This replaces an earlier attempt that composited separated transparent objects onto a shared
 * midnight-teal background. That approach is abandoned: it rebuilt each card rather than using it, and
 * the per-screen lighting, depth and staging of the originals were lost.
 *
 * ── The three locked cards had their subtitles removed, and why ─────────────
 * Hadith's baked subtitle read "Verified narrations, clearly sourced.", Duas' read "Supplications for
 * every part of your day.", and Mosques' read "Find masjids near you." All three are **false**: no
 * provider is approved for any of them, so nothing is sourced, supplied or findable.
 *
 * A false statement in an image is a false statement in the product. It cannot be corrected by an
 * accessibility label or by honest text further down the screen, because a sighted user reads the
 * picture. So the subtitle band was removed from those three images and the honest wording is rendered
 * natively in the cleared space — `lockedSubtitle` below.
 *
 * The removal was safe to do here specifically: on all three the subtitle sat on a near-flat dark
 * gradient (measured horizontal roughness 1.08–2.28), which reconstructs exactly by interpolating
 * between the rows above and below. The eyebrow, heading, background and object are untouched, and zero
 * glyph pixels remain in the band. `docs/FAITH_HERO_ASSETS.md` records the method.
 *
 * ── The remaining five keep their baked copy, because it is true ────────────
 * Qur'an, Qibla, Tasbih and Calendar describe what those screens actually do. Prayer keeps the generic
 * heading "Next prayer" — generic being the point: it names no prayer and states no time, and the real
 * prayer, its location-local time and the live countdown are rendered natively in the card immediately
 * below the hero. Nothing dynamic is drawn over the image.
 *
 * ── The trade the baked copy represents ────────────────────────────────────
 * Baked text cannot be restyled, translated, reflowed, or scaled by the OS font setting. Those are real
 * losses, accepted because the alternative was rebuilding the artwork. What the app must not do is draw
 * its own copy over it — two sets of the same words is worse than one set that cannot scale.
 *
 * ── The sources are not modified ───────────────────────────────────────────
 * They live at `D:\ChatGPT\NoorLife\selected-faith-hero-cards-button-free`.
 */

export type FaithHeroImageKey =
  'quran' | 'hadith' | 'duas' | 'prayer' | 'qibla' | 'tasbih' | 'mosques' | 'calendar';

export type FaithHeroImage = {
  readonly source: ImageSourcePropType;
  /**
   * Everything a sighted user reads on this hero, as one string.
   *
   * Not a description of the picture — the *replacement* for text a screen reader cannot otherwise
   * reach. It matches what is visible word for word: for the five unmodified cards that is the baked
   * eyebrow, heading and subtitle; for the three locked ones it is the baked eyebrow and heading plus
   * the native `lockedSubtitle`, because that is what is on screen.
   *
   * The scenery is deliberately absent. "A mosque at night with a crescent moon" is not something the
   * screen is telling the user, and reading it first buries the point.
   */
  readonly accessibleName: string;
  /**
   * Honest subtitle text, rendered natively into the band the false baked one was removed from.
   *
   * Present only on the three locked heroes. Its absence is what marks a card as carrying its own
   * complete, truthful copy — so a future locked screen cannot be wired up without supplying one.
   */
  readonly lockedSubtitle?: string;
};

/**
 * ── Why `require` at module scope ───────────────────────────────────────────
 * Metro resolves an asset `require` to a numeric handle at bundle time — a registry lookup, not a
 * decode. The bitmap is decoded only when an `Image` mounts with that handle, so listing all eight here
 * costs eight integers and decodes exactly the one hero on screen. All eight are local files; nothing
 * here is fetched.
 */
export const faithHeroImages: Readonly<Record<FaithHeroImageKey, FaithHeroImage>> = {
  quran: {
    source: require('@assets/images/modules/faith/hero/quran-hero.png') as ImageSourcePropType,
    accessibleName: 'Faith. Qur’an. Read, listen and continue where you stopped.',
  },
  /** Subtitle removed from the image; the honest one is native. */
  hadith: {
    source:
      require('@assets/images/modules/faith/hero/hadith-hero-locked.png') as ImageSourcePropType,
    accessibleName: 'Faith library. Hadith. Verified Hadith content is not configured yet.',
    lockedSubtitle: 'Verified Hadith content is not configured yet.',
  },
  /**
   * ── The Duas subtitle names what is missing, not the screen ────────────────
   * It read "Verified Dua content is not configured yet." while the whole screen was locked, and
   * that was exact. It stopped being exact when the screen gained working content: a user now reads
   * "not configured yet" directly above their own Qur'an selections, with the Arabic on screen.
   *
   * The provider is still not connected, so the sentence keeps saying that — and adds the half that
   * is now also true, so the hero and the list underneath it agree.
   */
  duas: {
    source:
      require('@assets/images/modules/faith/hero/duas-hero-locked.png') as ImageSourcePropType,
    /* Contains the visible subtitle verbatim — a spoken name that paraphrases it is a second copy. */
    accessibleName:
      'Daily remembrance. Duas. No supplication provider yet. Your Qur’an selections are below.',
    lockedSubtitle: 'No supplication provider yet. Your Qur’an selections are below.',
  },
  /**
   * "Next prayer" is baked, and stays because it is generic.
   *
   * It names no prayer and states no time, so it cannot be wrong. The calculated result lives in
   * `faith-prayer-next` directly below — real prayer, real location-local time, live countdown — and the
   * accessible name repeats the generic heading rather than implying the hero holds the answer.
   */
  prayer: {
    source: require('@assets/images/modules/faith/hero/prayer-hero.png') as ImageSourcePropType,
    accessibleName: 'Prayer times. Next prayer. Times calculated for your location.',
  },
  qibla: {
    source: require('@assets/images/modules/faith/hero/qibla-hero.png') as ImageSourcePropType,
    accessibleName: 'Prayer direction. Qibla. Find the direction of the Kaaba from where you are.',
  },
  tasbih: {
    source: require('@assets/images/modules/faith/hero/tasbih-hero.png') as ImageSourcePropType,
    accessibleName: 'Daily dhikr. Tasbih. Count your remembrance with calm and focus.',
  },
  mosques: {
    source:
      require('@assets/images/modules/faith/hero/mosques-hero-locked.png') as ImageSourcePropType,
    accessibleName:
      'Places to pray. Mosques. Nearby mosque information requires an approved directory provider.',
    lockedSubtitle: 'Nearby mosque information requires an approved directory provider.',
  },
  calendar: {
    source: require('@assets/images/modules/faith/hero/calendar-hero.png') as ImageSourcePropType,
    accessibleName:
      'Hijri calendar. Calendar. Calculated Hijri dates alongside the Gregorian calendar.',
  },
};

/**
 * The images' shared dimensions, so the hero can assert its aspect rather than assume it.
 *
 * All eight are produced by one pipeline to 1083x432 — the hero at 3x. That is what lets a single baked
 * crop serve every supported width: the card is 361x144 dp at the reference and 294x117 at 320 dp, both
 * 2.507 to three figures, so `cover` never crops differently between devices.
 */
export const faithHeroImageSize = { width: 1083, height: 432 } as const;

/**
 * Where the baked copy sits, as fractions of the image.
 *
 * Native text has to line up with text that is part of the picture, so these come from measuring the
 * pixels rather than from a layout token: the baked headings start at 5.26%–6.65% of the width, well
 * inside the hero's own 14 dp padding, and the removed subtitle band spans 56%–75% of the height.
 *
 * Fractions rather than dp so the alignment holds at every width — the image is scaled, so the copy
 * inside it scales too, and a fixed inset would drift.
 */
export const faithHeroBakedCopy = {
  /** Left inset of the baked heading. The mean of the four measured cards, rounded up a hair. */
  leftFraction: 0.062,
  /** Top of the subtitle band, where native locked copy begins. */
  subtitleTopFraction: 0.56,
  /** How wide the copy column may run before it reaches the artwork. */
  widthFraction: 0.44,
} as const;
