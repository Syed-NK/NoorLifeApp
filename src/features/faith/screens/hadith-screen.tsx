import { View } from 'react-native';

import { moduleLayout } from '@features/modules/module-tokens';
import { useModuleMetrics } from '@features/modules/use-module-metrics';

import {
  FaithLibraryStatusCard,
  FaithLockedPreviewRows,
  FaithTrustNotice,
  type FaithLockedPreviewRowSpec,
} from '../components/faith-locked-library';
import { FaithPictogramDevAudit } from '../components/faith-pictogram-dev-audit';
import { FaithSectionHero } from '../components/faith-section-hero';
import { FaithScreen } from '../components/faith-screen';
import { faithHeroImages } from '../faith-hero-images';
import { faithPictogramSlot, type FaithPictogramId } from '../faith-pictogram-assets';
import { getFaithSubmenuEntry } from '../faith-submenu-assets';
import { faithNavKeys } from '../faith-routes';

/**
 * The three categories the approved reference previews.
 *
 * Declared as data so the screen's structure is one list rather than three near-identical blocks,
 * and so a test can assert the exact approved copy against a single source.
 *
 * Every pictogram resolves through `faith-pictogram-assets.ts` rather than naming a vector here.
 * The reference draws stacked volumes, a ribboned open book and a book beside a pocket watch, none
 * of which NoorLife has yet — so H1–H3 currently resolve to a restrained vector, and the screen
 * says so in development through `FaithPictogramDevAudit`. Installing the artwork is a change in
 * the registry; no line in this file moves.
 */
const HADITH_SLOTS: readonly FaithPictogramId[] = ['h1', 'h2', 'h3', 's1'];

const HADITH_PREVIEW_ROWS: readonly FaithLockedPreviewRowSpec[] = [
  {
    pictogram: faithPictogramSlot('h1'),
    label: 'Collections',
    description: 'Browse authenticated sources',
    testID: 'faith-hadith-row-collections',
  },
  {
    pictogram: faithPictogramSlot('h2'),
    label: 'Bookmarks',
    description: 'Your saved narrations',
    testID: 'faith-hadith-row-bookmarks',
  },
  {
    pictogram: faithPictogramSlot('h3'),
    label: 'Reading history',
    description: 'Continue where you stopped',
    testID: 'faith-hadith-row-history',
  },
];

/**
 * Hadith — locked until a verified provider is approved.
 *
 * ── What this replaced, and why removing it was the fix ─────────────────────
 * A collection list (Sahih al-Bukhari, Sahih Muslim, the Forty of an-Nawawi, with their real
 * narration counts) over a set of narration cards carrying translation, narrator, reference and an
 * authentication grade — all of it from `data/mock/mock-hadith.repository.ts`. Every card was
 * labelled sample content by an `UnverifiedSourceNotice` above the list.
 *
 * That label was honest and insufficient. The failure mode is not that a user misses the badge; it
 * is that the screen renders a *grade* — "Sahih (sound)" — beside a narration nobody checked against
 * a critical edition. A grade is a scholarly judgement with a chain of transmission behind it, and
 * NoorLife had no authority to state one. Accurate collection names and correct narration counts
 * made it worse rather than better: they are exactly the details that make the rest look checked.
 *
 * ── Why the preview rows are disabled rather than absent ────────────────────
 * An earlier version removed them entirely, on the reasoning that a disabled row advertises a
 * collection NoorLife cannot open. The approved reference takes the opposite view and it is the
 * better one: the rows name *categories* — Collections, Bookmarks, Reading history — not
 * narrations, so they promise a shape rather than content, and a screen that says what is coming is
 * more use than one that says only that nothing is here. They carry no press handler, no button
 * role and an explicit "not available yet" in their accessibility label, so nothing about them
 * claims to be reachable.
 *
 * The repository seam is untouched — `HadithRepository` still exists, still has its interface, and
 * still resolves through `useFaithRepositories`. Approving a provider is an implementation swap in
 * `di/faith-repository-context.tsx` and a rebuild of this screen against the same types.
 */
export function HadithScreen() {
  const { dp } = useModuleMetrics();

  return (
    <FaithScreen title="Hadith" activeKey={faithNavKeys.more} testID="faith-hadith">
      <View style={{ rowGap: dp(moduleLayout.sectionGap) }}>
        {/*
          The hero stays. It is NoorLife's own artwork and copy, it carries no narration, and
          removing it would make a locked screen look broken rather than deliberately unfinished.
        */}
        {/*
          No action pill: no Hadith provider is approved, so there is nothing for one to do. The locked
          status is carried natively by `FaithProviderLockedState` immediately below, which is text a
          screen reader reaches — the hero's baked subtitle reads "Verified narrations, clearly sourced."
          and cannot be edited, so the honest statement has to live outside the image.
        */}
        <FaithSectionHero
          submenu="hadith"
          heroImage={faithHeroImages.hadith}
          summary="Narrations from the major collections, with their grading."
        />

        {/*
          The one genuinely matching asset on this screen: `02-hadith.png` is NoorLife's own
          emerald-and-gold bound volume, which is what the reference draws in this slot. Reused
          rather than re-generated.
        */}
        <FaithLibraryStatusCard
          pictogram={{ kind: 'png', source: getFaithSubmenuEntry('hadith').source }}
          title="Hadith library"
          body="Verified collections will appear here when a trusted provider is connected."
          testID="faith-hadith-status"
        />

        <FaithLockedPreviewRows rows={HADITH_PREVIEW_ROWS} testID="faith-hadith-preview" />

        <FaithTrustNotice
          pictogram={faithPictogramSlot('s1')}
          message="No unverified narrations are shown."
          testID="faith-hadith-trust"
        />

        {/* Development only. Renders nothing in a production bundle. */}
        <FaithPictogramDevAudit slots={HADITH_SLOTS} testID="faith-hadith-pictogram-audit" />
      </View>
    </FaithScreen>
  );
}
