import { useRouter } from 'expo-router';
import { View } from 'react-native';

import { globalRoutes } from '@application/navigation/routes';
import { moduleLayout } from '@features/modules/module-tokens';
import { useModuleMetrics } from '@features/modules/use-module-metrics';

import { FaithRow, FaithRowGroup } from '../components/faith-list';
import { FaithScreen } from '../components/faith-screen';
import { faithNavKeys, faithRoutes } from '../faith-routes';

/**
 * The "More" slot — the hub for everything not on the home grid.
 *
 * ── Why a hub and not a menu of dead ends ───────────────────────────────────
 * Every row here goes somewhere real. That is the phase's central requirement, and this
 * screen is where it is easiest to violate: a "More" list is the natural place to park
 * links to screens that do not exist. There are none — the route map is exhaustive and
 * the control-coverage test walks this screen asserting each row resolves.
 */
export function MoreScreen() {
  const router = useRouter();
  const { dp } = useModuleMetrics();

  return (
    <FaithScreen title="More" activeKey={faithNavKeys.more} testID="faith-more">
      <View style={{ rowGap: dp(moduleLayout.sectionGap) }}>
        <FaithRowGroup title="Learn" testID="faith-more-learn">
          {[
            <FaithRow
              key="hadith"
              title="Hadith"
              subtitle="Narrations from the major collections"
              icon="hadith"
              onPress={() => router.push(faithRoutes.hadith)}
              testID="faith-more-hadith"
            />,
            <FaithRow
              key="duas"
              title="Duas"
              subtitle="Supplications for the day and for difficulty"
              icon="worship"
              onPress={() => router.push(faithRoutes.duas)}
              testID="faith-more-duas"
            />,
            <FaithRow
              key="daily-ayah"
              title="Daily Ayah"
              subtitle="Today’s verse, with its translation"
              icon="quran"
              onPress={() => router.push(faithRoutes.dailyAyah)}
              testID="faith-more-daily-ayah"
            />,
          ]}
        </FaithRowGroup>

        <FaithRowGroup title="Practice" testID="faith-more-practice">
          {[
            <FaithRow
              key="tasbih"
              title="Tasbih"
              subtitle="Count your dhikr, saved on this device"
              icon="tasbih"
              onPress={() => router.push(faithRoutes.tasbih)}
              testID="faith-more-tasbih"
            />,
            <FaithRow
              key="qibla"
              title="Qibla"
              subtitle="Direction of prayer from where you are"
              icon="qibla"
              onPress={() => router.push(faithRoutes.qibla)}
              testID="faith-more-qibla"
            />,
            <FaithRow
              key="mosques"
              title="Mosques"
              subtitle="Nearby places to pray"
              icon="mosque"
              onPress={() => router.push(faithRoutes.mosques)}
              testID="faith-more-mosques"
            />,
            <FaithRow
              key="prayer-times"
              title="Prayer times"
              subtitle="Today’s times and your reminders"
              icon="clock"
              onPress={() => router.push(faithRoutes.prayerTimes)}
              testID="faith-more-prayer-times"
            />,
          ]}
        </FaithRowGroup>

        <FaithRowGroup title="Calendar" testID="faith-more-calendar-group">
          {[
            <FaithRow
              key="calendar"
              title="Islamic calendar"
              subtitle="Hijri dates alongside Gregorian"
              icon="calendar"
              onPress={() => router.push(faithRoutes.calendar)}
              testID="faith-more-calendar"
            />,
            <FaithRow
              key="events"
              title="Upcoming observances"
              subtitle="Ramadan, Eid and the days around them"
              icon="crescent"
              onPress={() => router.push(faithRoutes.events)}
              testID="faith-more-events"
            />,
          ]}
        </FaithRowGroup>

        <FaithRowGroup title="Yours" testID="faith-more-yours">
          {[
            <FaithRow
              key="bookmarks"
              title="Bookmarks"
              subtitle="Everything you saved"
              icon="bookmark"
              onPress={() => router.push(faithRoutes.bookmarks)}
              testID="faith-more-bookmarks"
            />,
            <FaithRow
              key="worship"
              title="Worship record"
              subtitle="What you marked today"
              icon="worship"
              onPress={() => router.push(faithRoutes.worship)}
              testID="faith-more-worship"
            />,
            <FaithRow
              key="search"
              title="Search"
              subtitle="Across translations, narrations and duas"
              icon="search"
              onPress={() => router.push(faithRoutes.search)}
              testID="faith-more-search"
            />,
          ]}
        </FaithRowGroup>

        <FaithRowGroup title="Settings" testID="faith-more-settings">
          {[
            <FaithRow
              key="preferences"
              title="Faith preferences"
              subtitle="Translation, reciter, calculation method"
              icon="settings"
              onPress={() => router.push(faithRoutes.preferences)}
              testID="faith-more-preferences"
            />,
            <FaithRow
              key="help"
              title="Help"
              subtitle="How the Faith module works"
              icon="help"
              onPress={() => router.push(globalRoutes.settings)}
              testID="faith-more-help"
            />,
          ]}
        </FaithRowGroup>
      </View>
    </FaithScreen>
  );
}
