import { Modal, ScrollView, View } from 'react-native';

import { AppIcon, PressableScale } from '@ds/components';
import { ModuleText } from '@features/modules/components';
import { moduleLayout, moduleNeutrals } from '@features/modules/module-tokens';
import { useModuleTheme } from '@features/modules/module-context';
import { useModuleMetrics } from '@features/modules/use-module-metrics';
import { minimumHitSlop } from '@shared/utils/a11y';

import type { SurahSummary } from '../../data/quran-content.repository';
import { ArabicText } from '../faith-list';

/**
 * The reader's own header: which surah, a way to change it, and a way into settings.
 *
 * ── The caret is the affordance, and it had to be real ──────────────────────
 * A reader with 114 destinations and no way to reach any of them without going back to a list is a
 * reader you leave to navigate. The caret opens the catalogue in place, from data the app already
 * holds — see `SurahPicker`, which takes the list as a prop precisely so that opening it costs
 * nothing and can never be the thing that makes the header wait.
 *
 * ── Why the metadata is a line below rather than a second bar ───────────────
 * Meaning, revelation place and ayah count situate a surah, and they are read once when you arrive
 * rather than consulted while you read. A second full-width bar repeating the name in both scripts
 * would take permanent height from the reading column for a fact the first line already carries.
 */
export function ReaderHeader({
  surah,
  shown,
  highlightAyah,
  onOpenPicker,
  onOpenInfo,
  onOpenSettings,
}: {
  readonly surah: SurahSummary;
  readonly shown: number;
  readonly highlightAyah: number | null;
  /** `null` when the catalogue has not loaded, which is what removes the caret rather than break it. */
  readonly onOpenPicker: (() => void) | null;
  /** Where the source, the edition and the licence are stated. */
  readonly onOpenInfo: () => void;
  readonly onOpenSettings: () => void;
}) {
  const theme = useModuleTheme();
  const { dp } = useModuleMetrics();

  const place = surah.revelation === 'meccan' ? 'Meccan' : 'Medinan';
  const spokenPosition = highlightAyah === null ? '' : `. Opened at verse ${highlightAyah}`;

  return (
    <View style={{ rowGap: dp(6) }} testID="faith-reader-header">
      {/*
        The surah, centred, with the two controls that belong to the reading rather than to the
        app: what this text is, and how it is displayed. Back and profile are the scaffold's, one
        row above — this bar deliberately does not repeat them.

        The Arabic name is not here. It used to sit between the selector and the settings glyph,
        where it competed with the surah's own name for the same line and left the selector barely
        wider than the word inside it. It is drawn once, larger, in the opening below.
      */}
      <View style={{ flexDirection: 'row', alignItems: 'center', columnGap: dp(4) }}>
        <PressableScale
          onPress={() => onOpenPicker?.()}
          disabled={onOpenPicker === null}
          accessibilityRole={onOpenPicker === null ? 'header' : 'button'}
          accessibilityLabel={
            onOpenPicker === null
              ? `Surah ${surah.number}, ${surah.name}`
              : `Surah ${surah.number}, ${surah.name}. Choose another surah`
          }
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            columnGap: dp(6),
            flex: 1,
            minWidth: 0,
            minHeight: dp(moduleLayout.minTouchTarget),
          }}
          testID="faith-reader-surah-selector"
        >
          <ModuleText
            token="heroTitle"
            numberOfLines={1}
            color={theme.ink}
            style={{ flexShrink: 1 }}
          >
            {surah.name}
          </ModuleText>
          {/*
            Drawn only when it does something. A caret beside a control that cannot open is the
            same promise-the-build-cannot-keep as a disabled play button.
          */}
          {onOpenPicker === null ? null : (
            <AppIcon name="chevron-down" size={dp(18)} color={theme.ink} />
          )}
        </PressableScale>

        <HeaderControl
          icon="info-outline"
          label="About this text and its translation"
          onPress={onOpenInfo}
          testID="faith-reader-content-info"
        />
        <HeaderControl
          icon="settings"
          label="Reading settings"
          onPress={onOpenSettings}
          testID="faith-reader-settings"
        />
      </View>

      <View
        accessible
        accessibilityLabel={`Surah ${surah.number}, ${surah.name}, ${surah.meaning}. ${place}, ${surah.ayahCount} verses. Showing ${shown}${spokenPosition}`}
        testID="faith-reader-header-label"
      >
        <ModuleText token="caption" numberOfLines={2}>
          {`Surah ${surah.number} • ${surah.meaning} • ${place} • ${surah.ayahCount} verses`}
        </ModuleText>
      </View>
    </View>
  );
}

/**
 * One of the reader header's two trailing controls.
 *
 * A bordered disc rather than a bare glyph, matching the header controls the module framework draws
 * one row above: two icons floating loose beside a centred title read as decoration, and a reader
 * whose only two entry points look decorative is a reader whose settings nobody finds.
 */
function HeaderControl({
  icon,
  label,
  onPress,
  testID,
}: {
  readonly icon: 'info-outline' | 'settings';
  readonly label: string;
  readonly onPress: () => void;
  readonly testID: string;
}) {
  const { dp } = useModuleMetrics();
  const size = dp(moduleLayout.headerControl);

  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={minimumHitSlop(size)}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: 1,
        borderColor: moduleNeutrals.border,
        backgroundColor: moduleNeutrals.surface,
        alignItems: 'center',
        justifyContent: 'center',
      }}
      testID={testID}
    >
      <AppIcon name={icon} size={dp(18)} color={moduleNeutrals.textSecondary} />
    </PressableScale>
  );
}

/**
 * The 114 surahs, over the reader.
 *
 * ── It is given the catalogue rather than fetching one ──────────────────────
 * The list is already in memory — Qur'an home hydrated it at startup and it is served from the
 * persisted store. A picker that issued its own request would put a spinner over a reader for data
 * the process is already holding, and would make opening the caret a network event.
 *
 * A `ScrollView` rather than a `FlatList`: the list is exactly 114 rows of two short strings, it is
 * built once when the sheet opens, and virtualizing it would add a windowing pass and a blank-cell
 * state to something that measures in single-digit milliseconds.
 */
export function SurahPicker({
  surahs,
  currentSurah,
  onSelect,
  onDismiss,
}: {
  readonly surahs: readonly SurahSummary[];
  readonly currentSurah: number;
  readonly onSelect: (surah: number) => void;
  readonly onDismiss: () => void;
}) {
  const theme = useModuleTheme();
  const { dp } = useModuleMetrics();

  return (
    <Modal
      visible
      animationType="slide"
      transparent={false}
      onRequestClose={onDismiss}
      testID="faith-reader-surah-picker"
    >
      <View style={{ flex: 1, backgroundColor: moduleNeutrals.pageBackground }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: dp(moduleLayout.pagePadding),
            paddingVertical: dp(12),
            columnGap: dp(8),
          }}
        >
          <ModuleText token="sectionTitle" numberOfLines={1} style={{ flex: 1 }}>
            Choose a surah
          </ModuleText>
          <PressableScale
            onPress={onDismiss}
            accessibilityRole="button"
            accessibilityLabel="Close surah list"
            hitSlop={minimumHitSlop(dp(20))}
            testID="faith-reader-surah-picker-close"
          >
            <AppIcon name="close" size={dp(22)} color={moduleNeutrals.textSecondary} />
          </PressableScale>
        </View>

        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: dp(moduleLayout.pagePadding),
            paddingBottom: dp(24),
          }}
          testID="faith-reader-surah-picker-list"
        >
          {surahs.map((item) => (
            <PressableScale
              key={item.number}
              onPress={() => onSelect(item.number)}
              accessibilityRole="button"
              accessibilityState={{ selected: item.number === currentSurah }}
              accessibilityLabel={`Surah ${item.number}, ${item.name}, ${item.meaning}, ${item.ayahCount} verses${
                item.number === currentSurah ? ', currently open' : ''
              }`}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                columnGap: dp(10),
                paddingVertical: dp(12),
                borderBottomWidth: dp(1),
                borderBottomColor: moduleNeutrals.divider,
              }}
              testID={`faith-reader-surah-picker-${item.number}`}
            >
              <ModuleText
                token="caption"
                numberOfLines={1}
                style={{ minWidth: dp(28) }}
                {...(item.number === currentSurah ? { color: theme.ink } : {})}
              >
                {String(item.number)}
              </ModuleText>
              <View style={{ flex: 1, minWidth: 0 }}>
                <ModuleText
                  token="cardTitle"
                  numberOfLines={1}
                  {...(item.number === currentSurah ? { color: theme.ink } : {})}
                >
                  {item.name}
                </ModuleText>
                <ModuleText token="caption" numberOfLines={1}>
                  {`${item.meaning} • ${item.ayahCount} verses`}
                </ModuleText>
              </View>
              <ArabicText>{item.arabicName}</ArabicText>
            </PressableScale>
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}

/**
 * The surah's opening, in an original NoorLife treatment.
 *
 * ── Deliberately not the reference's ornamental frame ───────────────────────
 * The reference draws a Mushaf cartouche — a gold-and-green illuminated panel with the surah name in
 * proprietary calligraphy, and verse-end medallions that are glyphs from that application's own
 * Qur'an font. None of it is reproduced here. What NoorLife draws instead is made of its own tokens:
 * the Arabic name as **live text from the approved source**, a Faith-green rule beneath it, and the
 * transliterated name and meaning in the app's ordinary type.
 *
 * The distinction is not cosmetic. Baking the surah name into artwork would mean shipping Arabic as
 * a picture that no screen reader can read and no text size can grow; copying the frame would mean
 * shipping somebody else's illustration. This is the same information, drawn as text NoorLife owns
 * the rendering of.
 */
export function SurahOpening({ surah }: { readonly surah: SurahSummary }) {
  const theme = useModuleTheme();
  const { dp } = useModuleMetrics();

  return (
    <View
      accessible
      accessibilityLabel={`Surah ${surah.number}, ${surah.name}, ${surah.meaning}`}
      style={{ alignItems: 'center', paddingVertical: dp(14) }}
      testID="faith-reader-surah-opening"
    >
      {/*
        ── The geometric band ──────────────────────────────────────────────────
        A rule running the full column, interrupted in the middle by a bordered cartouche holding
        the surah's Arabic name, with a diamond either side of it. Every part of it is a `View` with
        a border and a rotation: nothing here is artwork, nothing is traced, and the Arabic inside
        is live text from the approved source, so it grows with the text size and a screen reader
        can read it. Baking any of that into an image is what §13 forbids and what would make the
        name unreadable to half the people who need it.
      */}
      <View style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch' }}>
        <View style={{ flex: 1, height: 1, backgroundColor: theme.border }} />
        <Diamond size={dp(8)} color={theme.border} />
        <View
          style={{
            marginHorizontal: dp(6),
            paddingHorizontal: dp(18),
            paddingVertical: dp(8),
            borderWidth: dp(1),
            borderColor: theme.border,
            borderRadius: dp(moduleLayout.radiusSmall),
            backgroundColor: theme.lightSurface,
            alignItems: 'center',
          }}
        >
          <ArabicText size="display" testID="faith-reader-opening-arabic">
            {surah.arabicName}
          </ArabicText>
        </View>
        <Diamond size={dp(8)} color={theme.border} />
        <View style={{ flex: 1, height: 1, backgroundColor: theme.border }} />
      </View>

      <ModuleText token="caption" numberOfLines={1} style={{ marginTop: dp(8) }}>
        {`${surah.name} • ${surah.meaning}`}
      </ModuleText>
    </View>
  );
}

/** A square stood on its corner. The band's only ornament, and it is two lines of style. */
function Diamond({ size, color }: { readonly size: number; readonly color: string }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderWidth: 1,
        borderColor: color,
        transform: [{ rotate: '45deg' }],
      }}
    />
  );
}
