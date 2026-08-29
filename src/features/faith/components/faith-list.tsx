import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppIcon, PressableScale } from '@ds/components';
import { ModuleText } from '@features/modules/components';
import { ModuleCard } from '@features/modules/components/module-card';
import { fontFamilies } from '@ds/tokens';
import type { IconName } from '@shared/models/icon';

import { FaithPictogram, type FaithPictogramSlot } from './faith-locked-library';
import { useModuleTheme } from '@features/modules/module-context';
import { moduleNeutrals } from '@features/modules/module-tokens';
import { useModuleMetrics } from '@features/modules/use-module-metrics';
import { minimumTouchTargetSize } from '@shared/utils/a11y';

/**
 * List primitives shared by the Faith sub-screens.
 *
 * Keeping the row here rather than in each screen is what makes fourteen screens look
 * like one module: identical touch target, identical chevron, identical disclosure
 * semantics, one place to fix a spacing bug.
 */

type FaithRowShared = {
  readonly title: string;
  readonly subtitle?: string;
  readonly meta?: string;
  readonly icon?: IconName;
  readonly iconColor?: string;
  /**
   * An approved pictogram in the leading slot, replacing `icon`.
   *
   * ── Why a slot rather than a source ─────────────────────────────────────────
   * It takes a `FaithPictogramSlot`, so a row can be given a registry slot whose artwork is
   * installed, held or not yet delivered, and it renders whatever that slot honestly resolves to
   * without the call site branching. A held slot arrives here as its restrained vector, exactly as
   * it did before its artwork existed.
   *
   * Rendered `resizeMode="contain"`, never tinted, never given a background or a second icon well —
   * the row is the only container, per the asset contract.
   */
  readonly pictogram?: FaithPictogramSlot;
  /** Arabic shown right-aligned above the title, e.g. a surah's name. */
  readonly arabic?: string;
  /** Replaces the trailing chevron — a bookmark toggle, a checkbox. */
  readonly trailing?: ReactNode;
  /**
   * Declares that `trailing` contains its own focusable control — a `Switch`, a button.
   *
   * ── The release defect this prop exists to prevent ──────────────────────────
   * A row with no `onPress` used to wrap `body` in `<View accessible>`. On Android, `accessible` means
   * *this subtree is one node*: the platform collapses everything inside it into a single
   * `android.view.ViewGroup` and stops exposing the children. The prayer-reminder rows put a `Switch`
   * in `trailing`, so the master switch and all five per-prayer switches disappeared from the
   * accessibility hierarchy — the dump showed a `ViewGroup` with `clickable=false` where a
   * `android.widget.Switch` should have been, and neither TalkBack nor an accessibility-driven tap
   * could reach `onValueChange`. Nothing about the JavaScript was wrong, which is why Jest never saw
   * it: `fireEvent` calls the prop directly and never goes near the platform's view tree.
   *
   * When this is set the row container is **not** `accessible`. The label moves onto the text column,
   * which becomes its own group, and the control in `trailing` stays an independent node with its own
   * name, value and hint. Verify with `uiautomator dump`, not with Jest alone.
   *
   * A row is never both `onPress` and `trailingInteractive` — the type below makes that impossible.
   */
  readonly accessibilityLabel?: string;
  readonly testID: string;
};

/**
 * A row is pressable, or it carries its own control. Never both.
 *
 * ── Why this is a union rather than two optional booleans ───────────────────
 * Because the component *silently ignores* `onPress` when `trailingInteractive` is set — for a
 * good reason of its own, documented at the branch below: a row press that also drove the control
 * beside it would put two handlers on one gesture.
 *
 * Silently ignoring it is the problem. The Prayer reminders rows passed both, so tapping a row did
 * nothing at all; `uiautomator` reported the row as `clickable=false` on the device while the Jest
 * case asserting the press *passed*, because `fireEvent.press` calls the prop directly and never
 * goes near the platform tree. Nothing about the JavaScript was wrong, and nothing could have
 * caught it: an ignored prop is invisible to types, to lint and to Jest.
 *
 * Now it is visible to the first of those. Passing both is a compile error, in every module, for
 * ever. A row that needs a press *and* a control puts a second control in `trailing` — two nodes,
 * two actions, no shared gesture — which is what those reminders rows do now.
 */
export type FaithRowProps = FaithRowShared &
  (
    | {
        readonly onPress?: () => void;
        readonly trailingInteractive?: false;
      }
    | {
        readonly onPress?: never;
        readonly trailingInteractive: true;
      }
  );

export function FaithRow({
  title,
  subtitle,
  meta,
  icon,
  iconColor,
  pictogram,
  arabic,
  onPress,
  trailing,
  trailingInteractive = false,
  accessibilityLabel,
  testID,
}: FaithRowProps) {
  const theme = useModuleTheme();
  const { dp } = useModuleMetrics();

  const rowLabel = accessibilityLabel ?? `${title}${subtitle === undefined ? '' : `, ${subtitle}`}`;

  /*
    The label lands on the text column instead of the row when the row carries its own control, so
    the column is one readable group and the control beside it stays a separate node. Spread rather
    than branched into the JSX so the non-interactive case keeps exactly the tree it had.
  */
  const textGroupProps = trailingInteractive
    ? { accessible: true, accessibilityLabel: rowLabel, testID: `${testID}-text` }
    : {};

  const body = (
    <View
      style={[
        styles.row,
        {
          columnGap: dp(10),
          minHeight: minimumTouchTargetSize(),
          paddingVertical: dp(6),
        },
      ]}
    >
      {/*
        The pictogram wins when both are supplied, so a row can be migrated to artwork without its
        `icon` having to be deleted in the same edit — and so a slot that resolves to a vector still
        lands in the same 22 dp leading box, keeping every row in the group aligned.
      */}
      {pictogram !== undefined ? (
        <FaithPictogram slot={pictogram} size={dp(22)} testID={`${testID}-pictogram`} />
      ) : icon === undefined ? null : (
        <AppIcon name={icon} size={dp(22)} color={iconColor ?? theme.ink} />
      )}
      <View style={styles.flex} {...textGroupProps}>
        <ModuleText token="rowLabel" numberOfLines={2}>
          {title}
        </ModuleText>
        {subtitle === undefined ? null : (
          <ModuleText token="rowMeta" numberOfLines={2}>
            {subtitle}
          </ModuleText>
        )}
      </View>
      {arabic === undefined ? null : (
        <ModuleText token="arabic" numberOfLines={1} style={styles.arabic}>
          {arabic}
        </ModuleText>
      )}
      {meta === undefined ? null : (
        <ModuleText token="rowMeta" numberOfLines={1}>
          {meta}
        </ModuleText>
      )}
      {trailing ??
        (onPress === undefined ? null : (
          <AppIcon name="chevron-forward" size={dp(16)} color={moduleNeutrals.textSecondary} />
        ))}
    </View>
  );

  /*
    ── A row with its own control: the container is transparent to accessibility ──
    No `accessible`, so nothing is merged. The text column carries the label (above) and the control
    in `trailing` remains an independently focusable, independently clickable node — on Android, an
    `android.widget.Switch` rather than a `ViewGroup` that swallowed one.

    Deliberately not also pressable. Making the whole row toggle the switch would put a second
    handler on the same gesture, and the two orders it can fire in — row-then-switch on touch,
    switch-only under an accessibility action — are exactly how a double toggle that lands back on
    the original value gets shipped. One control, one handler; the switch is already a 48 dp target.
  */
  if (trailingInteractive) {
    return (
      <View testID={testID} accessible={false}>
        {body}
      </View>
    );
  }

  if (onPress === undefined) {
    return (
      <View accessible accessibilityLabel={rowLabel} testID={testID}>
        {body}
      </View>
    );
  }

  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={rowLabel}
      testID={testID}
    >
      {body}
    </PressableScale>
  );
}

/** A card wrapping a set of rows, with hairlines between them. */
export function FaithRowGroup({
  title,
  action,
  children,
  testID,
}: {
  readonly title?: string;
  readonly action?: ReactNode;
  readonly children: readonly ReactNode[];
  readonly testID: string;
}) {
  const { dp } = useModuleMetrics();

  return (
    <ModuleCard testID={testID}>
      {title === undefined ? null : (
        <View style={[styles.groupHeader, { marginBottom: dp(4) }]}>
          <ModuleText
            token="cardTitle"
            numberOfLines={1}
            accessibilityRole="header"
            style={styles.flex}
          >
            {title}
          </ModuleText>
          {action}
        </View>
      )}
      {children.map((child, index) => (
        <View key={index}>
          {index === 0 ? null : <View style={styles.divider} accessible={false} />}
          {child}
        </View>
      ))}
    </ModuleCard>
  );
}

/**
 * Props that ask every layer capable of it to leave this text alone.
 *
 * ── What "no machine translation" means on React Native, honestly ───────────
 * The requirement is usually written as `translate="no"`, which is a **DOM** attribute: it tells
 * Google Translate, Safari's translation and the browser's own page-translate feature to skip an
 * element. React Native has no DOM, and `Text` has no such prop — so on iOS and Android there is no
 * translate attribute to set, and the guarantee comes from somewhere else: this app never sends
 * scripture to a translation service, and the repository contract has no method that could.
 * `quran-foundation.contract.ts` records that as `noAutomaticTranslation`, asserted by test.
 *
 * What *is* available on native is `accessibilityLanguage`, which tells VoiceOver and TalkBack to
 * read the text as Arabic rather than mispronouncing it through the interface language. That is the
 * meaningful native half and it is set below.
 *
 * On **web** — this project builds for `react-native-web` too — there is a real DOM node, and
 * `translate: 'no'` on it is exactly the control the requirement names. It is spread in through a
 * typed helper rather than added to the props inline, because `TextProps` does not declare it: the
 * cast is confined to one place with this note attached, instead of being repeated at every call
 * site or, worse, left out because the type complained.
 */
const noMachineTranslationProps = {
  accessibilityLanguage: 'ar',
  /**
   * Ignored by the native renderers, honoured by `react-native-web`, which forwards it to the DOM
   * node. Harmless where it is not understood, which is what makes setting it unconditionally the
   * simpler and more auditable choice than a `Platform.OS` branch.
   */
  translate: 'no',
} as const;

/**
 * Arabic scripture, rendered right-to-left.
 *
 * ── The font question ───────────────────────────────────────────────────────
 * `fontFamily` is deliberately **not** set. Poppins carries no Arabic glyphs, and the
 * project's own rule in `design-system/typography/fonts.ts` is that Arabic must not fall
 * back to it. Leaving the family unset lets the platform pick a system Arabic face, which
 * renders the harakat correctly; naming Poppins here would rely on per-glyph fallback
 * that varies by OS version and vendor.
 *
 * When a licensed Uthmani face is approved it is set here, in one place.
 *
 * ── The text is passed through untouched ────────────────────────────────────
 * `{children}` and nothing else: no `trim`, no `normalize`, no `replace`, no `numberOfLines` that
 * could ellipsize a verse. This is the last place Qur'anic Arabic passes through before it is drawn,
 * and it is the place where a well-meant tidy-up would be invisible in review.
 */
/**
 * The reader's scripture size **before** the 50% reduction, kept so the reduction is checkable.
 *
 * The reader used to resolve a 36–44sp band against the content width. 44 was its configured
 * maximum — the value a 393 dp handset and anything wider actually rendered, and therefore the
 * value the rejection was measured against.
 */
export const PREVIOUS_SCRIPTURE_FONT_SIZE = 44;

/**
 * The reader's scripture size: **22sp, exactly half of what it was.**
 *
 * ── One number, not a band ──────────────────────────────────────────────────
 * The band it replaces is gone rather than halved. Halving a responsive range would put the
 * narrowest devices at 18sp while a wide one sat at 22, so "half of the previous size" would be
 * true of one device and false of every other — and the whole point of the correction is that the
 * reduction is exactly 50%, everywhere, on every ayah. A single resolved value is the only shape
 * that statement has.
 *
 * ── The line height is 1.8×, and that ratio is load-bearing ─────────────────
 * The Uthmani text the approved source returns carries the full harakat set, including superscript
 * alif stacked over shadda and the pause marks. At the platform Naskh face those glyphs occupy real
 * vertical space above the baseline, and a line height under about 1.7× clips them against the line
 * above — silently, and only on the verses that have them. 40 / 22 is 1.82.
 */
export const SCRIPTURE_FONT_SIZE = PREVIOUS_SCRIPTURE_FONT_SIZE / 2;
export const SCRIPTURE_LINE_HEIGHT = 40;

/**
 * How far OS text scaling may grow the scripture.
 *
 * Scaling is honoured — it is not switched off — but it is bounded. At Android's largest setting an
 * unbounded 22sp becomes 29sp, which still reads; the cap exists so that a device at 1.8× or beyond
 * cannot push a single ayah past a screenful and leave the translation permanently below the fold.
 */
export const SCRIPTURE_MAX_FONT_SCALE = 1.4;

export function scriptureTypography(): {
  readonly fontSize: number;
  readonly lineHeight: number;
} {
  return { fontSize: SCRIPTURE_FONT_SIZE, lineHeight: SCRIPTURE_LINE_HEIGHT };
}

export function ArabicText({
  children,
  size = 'body',
  color,
  numberOfLines,
  testID,
}: {
  readonly children: string;
  /**
   * `scripture` is the reader's continuous-reading size — the 22sp above.
   *
   * `display` is retained for the surfaces that show one verse inside a card, and now resolves to
   * the same 22sp through a different route: it is scaled by the layout scale, because a card's
   * width shrinks with the device where the reading column's does not.
   */
  readonly size?: 'body' | 'display' | 'scripture';
  /**
   * Overrides the ink, for the one case where the scripture is not on the ordinary surface.
   *
   * Used by the reader's reciting state, where the Arabic block sits on Faith green. Optional and
   * unset everywhere else, so the default contrast the type was measured at is what almost every
   * verse is drawn with.
   */
  readonly color?: string;
  /**
   * Clamps the preview to a line count, ellipsising rather than cutting.
   *
   * ── Why a line clamp and never a height cap ─────────────────────────────────
   * A `maxHeight` on scripture crops the last line through the middle of its glyphs, and Arabic
   * carries harakat above and below the baseline, so the half-line a crop leaves behind is not
   * merely ugly — it is unreadable in a way that invites misreading. `numberOfLines` ends on a whole
   * line and marks the truncation, which is the honest way to say "there is more".
   *
   * Unset everywhere the full verse is the point: the reader, the daily-ayah screen. Set only where
   * a card is a *preview* of something a tap opens in full.
   */
  readonly numberOfLines?: number;
  readonly testID?: string;
}) {
  const { dp } = useModuleMetrics();
  const scripture = scriptureTypography();

  return (
    <ModuleText
      token="arabic"
      align="right"
      {...(color === undefined ? {} : { color })}
      {...(noMachineTranslationProps as unknown as { accessibilityLanguage: string })}
      /*
        Scaling is honoured and bounded, rather than switched off. See `SCRIPTURE_MAX_FONT_SCALE`.
      */
      {...(size === 'scripture' ? { maxFontSizeMultiplier: SCRIPTURE_MAX_FONT_SCALE } : {})}
      {...(numberOfLines === undefined ? {} : { numberOfLines, ellipsizeMode: 'tail' as const })}
      style={[
        styles.scripture,
        size === 'display' ? { fontSize: dp(22), lineHeight: dp(40) } : null,
        /*
          Not passed through `dp`. 22 is already the resolved reading size — half of the previous
          44 — and applying the layout scale on top of it would make a 360 dp handset render 20sp,
          which is neither the specified size nor exactly half of anything.
        */
        size === 'scripture'
          ? { fontSize: scripture.fontSize, lineHeight: scripture.lineHeight }
          : null,
      ]}
      testID={testID}
    >
      {children}
    </ModuleText>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  flex: {
    flex: 1,
    minWidth: 0,
  },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: moduleNeutrals.divider,
    marginVertical: 6,
  },
  arabic: {
    writingDirection: 'rtl',
  },
  scripture: {
    writingDirection: 'rtl',
    // No fontFamily — see the note on ArabicText.
  },
});

/** Re-exported so screens import one module for text and rows. */
export { fontFamilies };
