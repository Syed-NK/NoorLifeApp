import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';

import { AppIcon, PressableScale } from '@ds/components';
import { ModuleEmptyState, ModuleLoadingState } from '@features/modules/components';
import { moduleLayout, moduleNeutrals } from '@features/modules/module-tokens';
import { useModuleMetrics } from '@features/modules/use-module-metrics';
import { minimumHitSlop } from '@shared/utils/a11y';

import { FaithRow, FaithRowGroup } from '../components/faith-list';
import { FaithScreen } from '../components/faith-screen';
import { faithNavKeys } from '../faith-routes';
import { bookmarkKindLabel, bookmarkKindOrder } from '../hooks/use-bookmark';
import { readBookmarks, removeBookmark, type Bookmark } from '../storage/faith-bookmarks';

/**
 * Everything the user has saved, grouped by kind.
 *
 * Reads straight from storage rather than through a repository: a bookmark is the app's
 * own record of what the user chose, not content, and there is no server behind it in any
 * phase.
 */
export function BookmarksScreen() {
  const { dp } = useModuleMetrics();
  const [bookmarks, setBookmarks] = useState<readonly Bookmark[] | null>(null);

  useEffect(() => {
    let active = true;
    void readBookmarks().then((all) => {
      if (active) {
        setBookmarks(all);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const remove = useCallback(async (bookmark: Bookmark) => {
    const next = await removeBookmark(bookmark.kind, bookmark.id);
    setBookmarks(next);
  }, []);

  return (
    <FaithScreen title="Bookmarks" activeKey={faithNavKeys.quran} testID="faith-bookmarks">
      <View style={{ rowGap: dp(moduleLayout.sectionGap) }}>
        {bookmarks === null ? (
          <ModuleLoadingState rows={3} testID="faith-bookmarks-loading" />
        ) : bookmarks.length === 0 ? (
          <ModuleEmptyState
            title="Nothing saved yet"
            body="Tap the bookmark icon on a verse, narration or dua and it will appear here."
            actionLabel="Browse the Qur’an"
            testID="faith-bookmarks-empty"
          />
        ) : (
          bookmarkKindOrder.map((kind) => {
            const group = bookmarks.filter((item) => item.kind === kind);
            if (group.length === 0) {
              return null;
            }
            return (
              <FaithRowGroup
                key={kind}
                title={bookmarkKindLabel[kind]}
                testID={`faith-bookmarks-${kind}`}
              >
                {group.map((item) => (
                  <FaithRow
                    key={`${item.kind}:${item.id}`}
                    title={item.label}
                    subtitle={item.subtitle}
                    trailing={
                      <PressableScale
                        onPress={() => void remove(item)}
                        accessibilityRole="button"
                        accessibilityLabel={`Remove ${item.label} from bookmarks`}
                        hitSlop={minimumHitSlop(dp(20))}
                        testID={`faith-bookmark-remove-${item.kind}-${item.id}`}
                      >
                        <AppIcon name="close" size={dp(18)} color={moduleNeutrals.textSecondary} />
                      </PressableScale>
                    }
                    testID={`faith-bookmark-${item.kind}-${item.id}`}
                  />
                ))}
              </FaithRowGroup>
            );
          })
        )}
      </View>
    </FaithScreen>
  );
}
