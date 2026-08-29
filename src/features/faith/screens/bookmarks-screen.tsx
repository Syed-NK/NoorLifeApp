import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';

import { AppIcon, PressableScale } from '@ds/components';
import { ModuleEmptyState, ModuleLoadingState } from '@features/modules/components';
import { moduleLayout, moduleNeutrals } from '@features/modules/module-tokens';
import { useModuleMetrics } from '@features/modules/use-module-metrics';
import { minimumHitSlop, minimumTouchTargetSize } from '@shared/utils/a11y';

import { FaithRow, FaithRowGroup } from '../components/faith-list';
import { FaithScreen } from '../components/faith-screen';
import { faithNavKeys, readerHref } from '../faith-routes';
import { bookmarkKindLabel, bookmarkKindOrder } from '../hooks/use-bookmark';
import { readBookmarks, removeBookmark, type Bookmark } from '../storage/faith-bookmarks';

/**
 * Everything the user has saved, grouped by kind.
 *
 * Reads straight from storage rather than through a repository: a bookmark is the app's own record
 * of what the user chose, not content, and there is no server behind it in any phase.
 *
 * ── Ayah bookmarks open their verse ─────────────────────────────────────────
 * Every row here used to be inert — the list rendered, and tapping a saved verse did nothing, which
 * made the feature a write-only log. An ayah bookmark now opens the reader at its surah with the
 * verse named, which is the whole point of having saved it. Hadith and dua bookmarks stay
 * non-navigable for the honest reason that neither of those screens is addressable yet; they carry
 * no chevron, so nothing invites a tap that would not answer.
 */
export function BookmarksScreen() {
  const router = useRouter();
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
                    onPress={openBookmark(item, router)}
                    accessibilityLabel={
                      item.kind === 'ayah'
                        ? `${item.label}. Opens the reader at this verse.`
                        : item.label
                    }
                    trailing={
                      <PressableScale
                        onPress={() => void remove(item)}
                        accessibilityRole="button"
                        accessibilityLabel={`Remove ${item.label} from bookmarks`}
                        hitSlop={minimumHitSlop(dp(20))}
                        style={{
                          minWidth: minimumTouchTargetSize(),
                          minHeight: minimumTouchTargetSize(),
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
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

/**
 * Splits an ayah bookmark's id back into a surah and a verse.
 *
 * The id is `${surah}:${ayah}`, written by the reader. Parsing it rather than storing two more
 * fields keeps the one identifier the toggle already keys on — but it does mean a malformed id must
 * be handled rather than assumed away, which is what the `null` return is for.
 */
export function parseAyahBookmarkId(id: string): { surah: number; ayah: number } | null {
  const [surahPart, ayahPart, ...rest] = id.split(':');
  if (rest.length > 0 || surahPart === undefined || ayahPart === undefined) {
    return null;
  }
  const surah = Number.parseInt(surahPart, 10);
  const ayah = Number.parseInt(ayahPart, 10);
  if (!Number.isInteger(surah) || surah < 1 || surah > 114) {
    return null;
  }
  if (!Number.isInteger(ayah) || ayah < 1) {
    return null;
  }
  return { surah, ayah };
}

/**
 * What a bookmark row does when tapped, or `undefined` when it should not be tappable.
 *
 * Returning `undefined` rather than a no-op handler matters: `FaithRow` draws its chevron from the
 * presence of `onPress`, so a hadith bookmark renders with no disclosure indicator and does not
 * invite a tap that would go nowhere.
 */
function openBookmark(
  bookmark: Bookmark,
  router: { push: (href: ReturnType<typeof readerHref>) => void },
): (() => void) | undefined {
  if (bookmark.kind !== 'ayah') {
    return undefined;
  }
  const reference = parseAyahBookmarkId(bookmark.id);
  if (reference === null) {
    return undefined;
  }
  return () => router.push(readerHref(reference.surah, reference.ayah));
}
