import { View } from 'react-native';

import { moduleLayout } from '@features/modules/module-tokens';
import { useModuleMetrics } from '@features/modules/use-module-metrics';

import { FaithSectionHero } from '../components/faith-section-hero';
import { FaithScreen } from '../components/faith-screen';
import { FaithProviderLockedState } from '../components/faith-states';
import { faithHeroImages } from '../faith-hero-images';
import { faithNavKeys } from '../faith-routes';

/**
 * Nearby mosques — locked until a directory provider is approved.
 *
 * ── Qibla used to live here too, and no longer does ─────────────────────────
 * The two shared this file because both are geospatial and both hit the same permission wall. That
 * stopped being the dominant similarity once Qibla grew a live compass: it now owns a sensor
 * subscription, three calibration states and a no-magnetometer path, none of which a list of places
 * has any use for. It is `qibla-screen.tsx` now.
 *
 * ── What this replaced, and why removing it was the fix ─────────────────────
 * A "Nearby" list built from `data/mock/mock-mosque.repository.ts` — two fabricated mosques with
 * invented names, street addresses, facility lists and distances in metres, under an info banner
 * reading "Sample listings."
 *
 * The banner was honest and the rows were not survivable. A distance is a directional claim: "320 m"
 * tells somebody a mosque is a four-minute walk away, and a user acting on it walks to an address
 * that does not exist. That is a different order of harm from a sample narration, because it is
 * actionable in the physical world. Facilities compounded it — "Women's prayer hall", "Wheelchair
 * access" — attributes a person may specifically depend on and travel for.
 *
 * ── Why the location permission flow went with it ───────────────────────────
 * The screen resolved the user's coordinates before rendering, so it raised a location-permission
 * path to sort fixtures by distance from a real position. Asking for location to power fabricated
 * data is a privacy cost with no benefit, so the request is gone. It returns with the provider,
 * which is the point at which the coordinate starts buying the user something.
 *
 * ── Why there is no skeleton and no search field ────────────────────────────
 * There is nothing to load and nothing to search. The brief is explicit that an indefinite skeleton
 * is not acceptable, and a search box that cannot return a mosque is a control that lies about the
 * screen's capability.
 *
 * The `MosqueRepository` seam is untouched, and `findNearby` still takes a coordinate. Approving a
 * provider is an implementation swap in `di/faith-repository-context.tsx`, restoring the permission
 * flow through `useLocationPermission`, and rebuilding this list against the same types.
 */
export function MosquesScreen() {
  return (
    <FaithScreen title="Mosques" activeKey={faithNavKeys.more} testID="faith-mosques">
      <MosquesBody />
    </FaithScreen>
  );
}

/** Split out so it renders inside the scaffold's `ModuleProvider`. */
function MosquesBody() {
  const { dp } = useModuleMetrics();

  return (
    <View style={{ rowGap: dp(moduleLayout.sectionGap) }}>
      {/*
        Locked: no approved directory provider, so no action. The baked subtitle reads "Find masjids near
        you", which this build cannot do — so the locked state below states that in native text, and the
        hero carries no control that would imply otherwise.
      */}
      <FaithSectionHero
        submenu="mosques"
        heroImage={faithHeroImages.mosques}
        summary="Places to pray near you."
      />

      <FaithProviderLockedState
        icon="mosque"
        title="Nearby mosques are not available yet"
        body="Nearby mosque data requires an approved directory provider, which NoorLife does not yet have. Names, addresses and distances will appear here once one is in place. NoorLife will not show places it cannot verify, and does not ask for your location for this screen until it can."
        testID="faith-mosques"
      />
    </View>
  );
}
