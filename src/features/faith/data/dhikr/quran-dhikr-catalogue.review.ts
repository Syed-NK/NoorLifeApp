import type { CuratedDhikrReference } from './quran-dhikr-catalogue';

/**
 * **Development only. Nothing in this file may reach a production build.**
 *
 * ── What this file is for ───────────────────────────────────────────────────
 * A place to write down references *proposed* for the Quran-derived Dhikr catalogue, so that the
 * review process has something concrete to review, without those proposals being able to reach a
 * user. Every entry is `reviewStatus: 'pending'`, which `approvedForProduction` rejects.
 *
 * ── The two independent guards, and why one is not enough ───────────────────
 * 1. **The gate.** `approvedForProduction` returns false for anything not `approved`, so even if
 *    this array were passed to it, nothing here would survive.
 * 2. **The import graph.** No production module imports this file. `quran-derived-dhikr.test.ts`
 *    asserts that, by scanning `src/` for importers outside `__tests__`.
 *
 * The second guard exists because the first is a runtime check and runtime checks get relaxed. A
 * file that is never imported cannot be shipped by a call site that decided to be helpful.
 *
 * ── Why it is empty ─────────────────────────────────────────────────────────
 * Because proposing a reference is itself an editorial religious act, and a developer listing verses
 * from memory is precisely how five source-less dhikr presets came to ship in this app once before.
 * The structure is here; the proposals come from whoever is qualified to make them, and are entered
 * with a real `contextNote` describing the basis on which the reference is being proposed.
 *
 * A proposal is entered like this — `review` stays `null` until a reviewer fills it in, and
 * `recommendedTarget` stays `null` unless that reviewer states a count:
 *
 * ```ts
 * {
 *   id: 'qf.<stable-slug>',
 *   surah: 0, startAyah: 0, endAyah: 0,
 *   title: '<supplied by the curated catalogue, not composed here>',
 *   category: 'quranic-remembrance',
 *   recommendedTarget: null,
 *   reviewStatus: 'pending',
 *   review: null,
 *   contextNote: '<why this reference is proposed, and on what basis>',
 *   enabled: false,
 *   version: 1,
 * }
 * ```
 */
export const PENDING_DHIKR_REVIEW_QUEUE: readonly CuratedDhikrReference[] = [];
