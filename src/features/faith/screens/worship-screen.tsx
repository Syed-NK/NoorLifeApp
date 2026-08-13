import { useCallback, useState } from 'react';
import { View } from 'react-native';

import { AppIcon, PressableScale } from '@ds/components';
import { ModuleText } from '@features/modules/components';
import { ModuleCard } from '@features/modules/components/module-card';
import { ModuleProgressBar } from '@features/modules/components/module-chart';
import { useModuleTheme } from '@features/modules/module-context';
import { moduleLayout, moduleNeutrals } from '@features/modules/module-tokens';
import { useModuleMetrics } from '@features/modules/use-module-metrics';
import { statusLabel } from '@shared/utils/a11y';

import { FaithRow, FaithRowGroup } from '../components/faith-list';
import { FaithResourceView, FaithScreen } from '../components/faith-screen';
import { todayIso } from '../data/mock/mock-support';
import type { WorshipDay, WorshipEntry } from '../data/worship.repository';
import { useFaithRepositories } from '../di/faith-repository-context';
import { faithNavKeys } from '../faith-routes';
import { useMutableFaithResource } from '../hooks/use-faith-resource';

/**
 * The worship checklist — the `worship` bottom-navigation slot.
 *
 * ── Persistence, and what it costs ──────────────────────────────────────────
 * Marks are written to the device and survive a restart. Tapping a row cycles it through
 * completed → missed → upcoming, and the repository returns the whole updated day so the
 * progress figure and the row can never disagree.
 *
 * ── Tone ────────────────────────────────────────────────────────────────────
 * "Missed" is stated plainly and is not styled as a failure — no red, no streak-broken
 * banner, no comparison. The count reads "3 of 7 marked", not "you missed 4".
 */
export function WorshipScreen() {
  const { dp } = useModuleMetrics();
  const { worship } = useFaithRepositories();
  const [date] = useState(todayIso());

  const day = useMutableFaithResource(
    `worship.${date}`,
    useCallback(() => worship.getDay(date), [worship, date]),
  );

  const cycle = async (entry: WorshipEntry) => {
    const next =
      entry.status === 'completed'
        ? 'missed'
        : entry.status === 'missed'
          ? 'upcoming'
          : 'completed';
    const result = await worship.setEntryStatus(date, entry.key, next);
    day.apply(result);
  };

  return (
    <FaithScreen title="Worship" activeKey={faithNavKeys.worship} testID="faith-worship">
      <View style={{ rowGap: dp(moduleLayout.sectionGap) }}>
        <FaithResourceView
          resource={day}
          empty={{
            title: 'Nothing to track yet',
            body: 'Your day’s prayers and adhkar will appear here.',
          }}
          loadingRows={5}
          testID="faith-worship-body"
        >
          {(value) => (
            <View style={{ rowGap: dp(moduleLayout.cardGap) }}>
              <DaySummary day={value} />
              <FaithRowGroup title="Today" testID="faith-worship-list">
                {value.entries.map((entry) => (
                  <WorshipRow key={entry.key} entry={entry} onCycle={() => void cycle(entry)} />
                ))}
              </FaithRowGroup>
            </View>
          )}
        </FaithResourceView>
      </View>
    </FaithScreen>
  );
}

function DaySummary({ day }: { readonly day: WorshipDay }) {
  const { dp } = useModuleMetrics();

  return (
    <ModuleCard testID="faith-worship-summary">
      <ModuleText token="cardTitle" numberOfLines={1}>
        {`${day.completed} of ${day.total} marked`}
      </ModuleText>
      <ModuleText token="caption" numberOfLines={2}>
        Tap a row to change how it is marked. Nothing here is shared with anyone.
      </ModuleText>
      <View style={{ marginTop: dp(8) }}>
        <ModuleProgressBar
          value={day.total === 0 ? 0 : day.completed / day.total}
          accessibilityLabel={`${day.completed} of ${day.total} acts marked today`}
          testID="faith-worship-progress"
        />
      </View>
    </ModuleCard>
  );
}

const STATUS_WORD: Readonly<Record<WorshipEntry['status'], string>> = {
  completed: 'Completed',
  current: 'Now',
  upcoming: 'Upcoming',
  missed: 'Not marked',
};

function WorshipRow({
  entry,
  onCycle,
}: {
  readonly entry: WorshipEntry;
  readonly onCycle: () => void;
}) {
  const theme = useModuleTheme();
  const { dp } = useModuleMetrics();

  // Status is carried by an icon shape and a word, never by colour alone.
  const mark =
    entry.status === 'completed' ? (
      <AppIcon name="check-circle" size={dp(22)} color={theme.ink} />
    ) : entry.status === 'current' ? (
      <View
        style={{
          width: dp(16),
          height: dp(16),
          borderRadius: dp(8),
          backgroundColor: theme.ink,
        }}
      />
    ) : (
      <View
        style={{
          width: dp(16),
          height: dp(16),
          borderRadius: dp(8),
          borderWidth: 1.5,
          borderColor: moduleNeutrals.border,
        }}
      />
    );

  return (
    <PressableScale
      onPress={onCycle}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: entry.status === 'completed' }}
      // Spoken with its time only when one was calculated — see `WorshipEntry.detail`.
      accessibilityLabel={statusLabel(
        entry.detail === undefined ? entry.label : `${entry.label}, ${entry.detail}`,
        STATUS_WORD[entry.status],
      )}
      accessibilityHint="Changes how this act is marked."
      testID={`faith-worship-entry-${entry.key}`}
    >
      <FaithRow
        title={entry.label}
        subtitle={entry.detail}
        meta={STATUS_WORD[entry.status]}
        trailing={mark}
        testID={`faith-worship-row-${entry.key}`}
      />
    </PressableScale>
  );
}
