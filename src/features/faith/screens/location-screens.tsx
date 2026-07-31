import { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppIcon } from '@ds/components';
import { ModuleStatusBanner, ModuleText } from '@features/modules/components';
import { ModuleCard } from '@features/modules/components/module-card';
import { useModuleTheme } from '@features/modules/module-context';
import { moduleLayout, moduleNeutrals } from '@features/modules/module-tokens';
import { useModuleMetrics } from '@features/modules/use-module-metrics';

import { FaithRow, FaithRowGroup } from '../components/faith-list';
import { FaithResourceView, FaithScreen } from '../components/faith-screen';
import { hasData } from '../data/faith-result';
import type { QiblaBearing } from '../data/mosque.repository';
import { useFaithRepositories } from '../di/faith-repository-context';
import { faithNavKeys } from '../faith-routes';
import { useFaithResource } from '../hooks/use-faith-resource';

/**
 * The two geospatial Faith screens.
 *
 * Both resolve a location first and both surface `permission-required` through the shared
 * `FaithResourceView`, so the permission state is identical on each — which is the point
 * of routing it through one component rather than writing it twice.
 */

/**
 * Qibla.
 *
 * ── What this screen does and does not claim ────────────────────────────────
 * It shows the true-north bearing to the Kaaba, computed from the resolved coordinate.
 * It does **not** show a live compass needle, because that needs the magnetometer and a
 * declination correction that this phase does not build — and a needle that ignored the
 * device's heading would point confidently in the wrong direction. The banner says which
 * of the two you are looking at, so nobody prays toward a number they thought was a
 * compass.
 */
export function QiblaScreen() {
  const { dp } = useModuleMetrics();
  const { mosque, prayerTimes } = useFaithRepositories();

  const bearing = useFaithResource(
    'faith.qibla',
    useCallback(async () => {
      const location = await prayerTimes.resolveCurrentLocation();
      if (!hasData(location)) {
        return location;
      }
      return mosque.getQiblaBearing(location.data.coordinate);
    }, [mosque, prayerTimes]),
  );

  return (
    <FaithScreen
      title="Qibla"
      activeKey={faithNavKeys.more}
      banner={
        <ModuleStatusBanner
          tone="info"
          message="This is the bearing from your location, not a live compass. Align it using your device’s compass app."
          testID="faith-qibla-banner"
        />
      }
      testID="faith-qibla"
    >
      <View style={{ rowGap: dp(moduleLayout.sectionGap) }}>
        <FaithResourceView
          resource={bearing}
          empty={{ title: 'No bearing', body: 'The Qibla direction could not be calculated.' }}
          loadingRows={2}
          testID="faith-qibla-body"
        >
          {(value) => <QiblaDial bearing={value} />}
        </FaithResourceView>
      </View>
    </FaithScreen>
  );
}

function QiblaDial({ bearing }: { readonly bearing: QiblaBearing }) {
  const theme = useModuleTheme();
  const { dp } = useModuleMetrics();
  const size = dp(200);
  const rounded = Math.round(bearing.bearingDegrees);

  return (
    <ModuleCard testID="faith-qibla-dial">
      <View style={{ alignItems: 'center', rowGap: dp(10) }}>
        <View
          style={[
            styles.dial,
            {
              width: size,
              height: size,
              borderRadius: size / 2,
              borderColor: theme.border,
              backgroundColor: theme.lightSurface,
            },
          ]}
          accessible
          accessibilityLabel={`Qibla bearing ${rounded} degrees from true north`}
        >
          {/* The arrow is rotated by the bearing; it indicates direction relative to
              true north, which the caption states explicitly. */}
          <View style={{ transform: [{ rotate: `${rounded}deg` }] }}>
            <AppIcon name="qibla" size={dp(72)} color={theme.ink} />
          </View>
        </View>

        <ModuleText token="heroScore" color={theme.ink} align="center" numberOfLines={1}>
          {`${rounded}°`}
        </ModuleText>
        <ModuleText token="caption" align="center" numberOfLines={2}>
          {`From true north • ${Math.round(bearing.distanceKm).toLocaleString()} km to Makkah`}
        </ModuleText>
      </View>
    </ModuleCard>
  );
}

/** Nearby mosques. Sample listings, attributed as such on every row. */
export function MosquesScreen() {
  const { dp } = useModuleMetrics();
  const { mosque, prayerTimes } = useFaithRepositories();

  const nearby = useFaithResource(
    'faith.mosques',
    useCallback(async () => {
      const location = await prayerTimes.resolveCurrentLocation();
      if (!hasData(location)) {
        return location;
      }
      return mosque.findNearby(location.data.coordinate);
    }, [mosque, prayerTimes]),
  );

  return (
    <FaithScreen title="Mosques" activeKey={faithNavKeys.more} testID="faith-mosques">
      <View style={{ rowGap: dp(moduleLayout.sectionGap) }}>
        <ModuleStatusBanner
          tone="info"
          message="Sample listings. Verified mosque data arrives with an approved directory source."
          testID="faith-mosques-banner"
        />

        <FaithResourceView
          resource={nearby}
          empty={{
            title: 'No mosques found nearby',
            body: 'Try widening the search area, or search by name.',
          }}
          loadingRows={3}
          testID="faith-mosques-body"
        >
          {(list) => (
            <FaithRowGroup title="Nearby" testID="faith-mosques-list">
              {list.map((item) => (
                <FaithRow
                  key={item.id}
                  title={item.name}
                  subtitle={`${item.address}${item.facilities.length === 0 ? '' : ` • ${item.facilities.join(', ')}`}`}
                  meta={formatDistance(item.distanceMetres)}
                  icon="mosque"
                  accessibilityLabel={`${item.name}, ${formatDistance(item.distanceMetres)} away, ${item.address}`}
                  testID={`faith-mosque-${item.id}`}
                />
              ))}
            </FaithRowGroup>
          )}
        </FaithResourceView>
      </View>
    </FaithScreen>
  );
}

function formatDistance(metres: number): string {
  return metres < 1000 ? `${metres} m` : `${(metres / 1000).toFixed(1)} km`;
}

const styles = StyleSheet.create({
  dial: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    backgroundColor: moduleNeutrals.surface,
  },
});
