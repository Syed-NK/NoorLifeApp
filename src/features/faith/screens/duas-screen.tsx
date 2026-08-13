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
 * ── These name intentions, not inventory ────────────────────────────────────
 * "Morning & evening" and "Everyday moments" describe categories a future provider is expected to
 * supply. They deliberately state no count, no example and no reference, because NoorLife has no
 * supplications to count — a row reading "24 duas" would be exactly the fabrication this screen
 * exists to remove.
 *
 * Every pictogram resolves through `faith-pictogram-assets.ts`. The reference draws a sunrise over
 * a bead strand, a dimensional house and a ribboned open book, none of which NoorLife has yet, so
 * D1–D3 currently resolve to a restrained vector and `FaithPictogramDevAudit` says so on the screen
 * in development.
 *
 * **D3 is deliberately H2's slot rather than a Duas-specific one.** The Bookmarks row here and the
 * Bookmarks row on Hadith are the same idea — a ribboned open book — and drawing two different
 * books for it would put two answers to one question three taps apart in the same module.
 */
const DUA_SLOTS: readonly FaithPictogramId[] = ['d1', 'd2', 'd3', 's1'];

const DUA_PREVIEW_ROWS: readonly FaithLockedPreviewRowSpec[] = [
  {
    pictogram: faithPictogramSlot('d1'),
    label: 'Morning & evening',
    description: 'Daily remembrance and protection',
    testID: 'faith-duas-row-morning-evening',
  },
  {
    pictogram: faithPictogramSlot('d2'),
    label: 'Everyday moments',
    description: 'Home, travel, meals and sleep',
    testID: 'faith-duas-row-everyday',
  },
  {
    pictogram: faithPictogramSlot('d3'),
    label: 'Bookmarks',
    description: 'Your saved supplications',
    testID: 'faith-duas-row-bookmarks',
  },
];

/**
 * Duas — locked until a verified provider is approved.
 *
 * ── What this replaced, and why removing it was the fix ─────────────────────
 * Three categories (Morning & Evening, Daily Life, In Difficulty) over supplication cards carrying
 * Arabic, transliteration, translation, a hadith reference and a repetition count — all from
 * `data/mock/mock-dua.repository.ts`, all labelled sample content by a notice above the list.
 *
 * A dua is scripture-adjacent religious text and the Arabic was rendered at display size as the
 * dominant element of each card. Unverified Arabic presented that way is the single most serious
 * integrity failure available to this module: a user may recite it. The references made it worse —
 * "Sahih al-Bukhari 6312" beside a supplication is a provenance claim NoorLife had not checked.
 *
 * ── Why bookmarking went with it ────────────────────────────────────────────
 * Each card could be bookmarked, which wrote a fixture id and its sample translation into the user's
 * own bookmark store — persisted, and outliving the screen that created it. Nothing here writes to
 * storage now.
 *
 * ── Why the preview rows are disabled rather than absent ────────────────────
 * The old category rows led to fixtures and were removed with them. The approved reference brings
 * rows back in a different form, and the distinction is the whole point: these name *categories* a
 * provider would fill, not supplications NoorLife has. They carry no press handler, no button role
 * and an explicit "not available yet" in their label, so none of them claims to be reachable, and
 * none of them states a count, an example or a reference.
 *
 * The `DuaRepository` seam is untouched. Approving a provider is an implementation swap in
 * `di/faith-repository-context.tsx` and a rebuild of this screen against the same types.
 */
export function DuasScreen() {
  const { dp } = useModuleMetrics();

  return (
    <FaithScreen title="Duas" activeKey={faithNavKeys.more} testID="faith-duas">
      <View style={{ rowGap: dp(moduleLayout.sectionGap) }}>
        {/* Locked: no approved provider, so no action. See the Hadith hero's note. */}
        <FaithSectionHero
          submenu="duas"
          heroImage={faithHeroImages.duas}
          summary="Supplications for the day and for difficulty."
        />

        {/*
          `03-duas.png` is NoorLife's own cupped hands over an emerald book — the artwork the
          reference draws in this slot. Reused rather than re-generated.
        */}
        <FaithLibraryStatusCard
          pictogram={{ kind: 'png', source: getFaithSubmenuEntry('duas').source }}
          title="Dua library"
          body="Verified supplications will appear here when a trusted source is connected."
          testID="faith-duas-status"
        />

        <FaithLockedPreviewRows rows={DUA_PREVIEW_ROWS} testID="faith-duas-preview" />

        <FaithTrustNotice
          pictogram={faithPictogramSlot('s1')}
          message="No unverified supplications are shown."
          testID="faith-duas-trust"
        />

        {/* Development only. Renders nothing in a production bundle. */}
        <FaithPictogramDevAudit slots={DUA_SLOTS} testID="faith-duas-pictogram-audit" />
      </View>
    </FaithScreen>
  );
}
