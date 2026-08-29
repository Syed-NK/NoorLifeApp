import { Pressable, StyleSheet, View } from 'react-native';

import { ModuleText } from '@features/modules/components';
import { useModuleTheme } from '@features/modules/module-context';
import { useModuleSurfaces } from '@features/modules/module-surfaces';
import { moduleNeutrals } from '@features/modules/module-tokens';
import { useModuleMetrics } from '@features/modules/use-module-metrics';
import { minimumTouchTargetSize } from '@shared/utils/a11y';

/**
 * **The one row of choice chips every Finance screen uses** — issue #116.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── The defect this exists to remove, measured ─────────────────────────────
 * Three screens had each copied this component, and all three copies bounded the chip's **height**
 * with `minimumTouchTargetSize()` and its **width** with nothing at all. A chip is
 * `text + 2 × paddingHorizontal` wide, so a short label produced a control below the accessibility
 * minimum on one axis while the other axis looked correct.
 *
 * Measured on `emulator-5554` — 1080×2400, 420 dpi, density 2.625, font scale 1.0 — on a release
 * build of `f5a9e02`, from `uiautomator` node bounds divided by the density `wm density` reports:
 *
 * | Chip                             | Bounds                     | Painted   | dp                |
 * | -------------------------------- | -------------------------- | --------- | ----------------- |
 * | `finance-filters-category-all`   | `[98,1186][201,1302]`      | 103×116px | **39.238**×44.190 |
 * | `finance-filters-category-Food`  | `[218,1186][419,1302]`     | 201×116px | 76.571×44.190     |
 *
 * The height was already right. The width was 4.762 dp under, on a chip — `All` — that the category
 * filter renders unconditionally, so every account with a categorised transaction had one.
 *
 * ── Why the label's own width was never the fix ────────────────────────────
 * At font scale 1.5 the same chip measures 49.14 dp and passes, because the larger text pushes it
 * past the minimum on its own. That is a coincidence of typography, not a bound: it means the
 * control is compliant only for users who have already enlarged their text, and undersized at the
 * default. A minimum that a longer word happens to satisfy is not a minimum, which is why this binds
 * both axes explicitly rather than relying on any label being wide enough.
 *
 * ── Both axes, from the one token, through the pixel-safe helper ───────────
 * `minimumTouchTargetSize()` is #96's helper: `ceil(44 × density) / density`, a value the pixel grid
 * can represent exactly, so Yoga's snapping cannot round it *below* 44. At density 2.625 a raw 44 dp
 * is 115.5 px and snaps down to 115 px — 43.81 dp — which is the second half of the same defect and
 * the reason the bound is not simply `touchTarget.minimum`.
 *
 * It is deliberately **not** passed through `dp()`. That helper scales a baseline down on narrow
 * screens, which is right for spacing and wrong for a bound: a minimum that shrinks on a small phone
 * is not a minimum, and a small phone is where a control is hardest to hit. `a11y.ts` states this at
 * length and #115 measures what it costs elsewhere.
 *
 * ── The bound is on the accessibility node itself ──────────────────────────
 * Both minimums sit on the `Pressable` that carries `accessibilityRole`, `accessibilityState` and
 * `accessibilityLabel` — the node a screen reader and an accessibility scanner actually measure.
 * `hitSlop` is refused for exactly this reason: it widens where a finger lands and leaves the
 * reported node undersized, so the control still fails an audit and still reads as small to
 * assistive technology.
 *
 * ── One component, because three copies drifted ────────────────────────────
 * The copies had already diverged — one styled its chip under a different style key, and one mapped
 * an empty choice key to `all` for its testID while the others did not. Three places to fix a bound
 * is three chances to fix two of them, and the one that is missed produces a plausible control
 * rather than an error. The empty-key mapping is kept here for every caller: no other screen uses an
 * empty key, so it changes no existing testID and removes the only behavioural difference between
 * the copies.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export type FinanceChoice = {
  readonly key: string;
  readonly label: string;
};

export type FinanceChoiceRowProps = {
  /** The group's caption, and the prefix of every chip's accessibility label. */
  readonly label: string;
  readonly choices: readonly FinanceChoice[];
  readonly selected: string;
  readonly onSelect: (value: string) => void;
  readonly testID: string;
};

export function FinanceChoiceRow({
  label,
  choices,
  selected,
  onSelect,
  testID,
}: FinanceChoiceRowProps) {
  const theme = useModuleTheme();
  const surfaces = useModuleSurfaces();
  const { dp } = useModuleMetrics();

  return (
    <View style={{ rowGap: dp(6) }} testID={testID}>
      <ModuleText token="caption" color={moduleNeutrals.textSecondary}>
        {label}
      </ModuleText>
      <View style={[styles.choices, { gap: dp(6) }]}>
        {choices.map((choice) => {
          const isActive = selected === choice.key;
          return (
            <Pressable
              key={choice.key}
              onPress={() => onSelect(choice.key)}
              accessibilityRole="radio"
              accessibilityState={{ selected: isActive }}
              accessibilityLabel={`${label}: ${choice.label}`}
              style={[
                styles.choice,
                {
                  /*
                    Both axes, unscaled — they are bounds, not dimensions. The width is what #116
                    added; without it a short label decides how big the control is.
                  */
                  minHeight: minimumTouchTargetSize(),
                  minWidth: minimumTouchTargetSize(),
                  borderRadius: dp(12),
                  borderColor: isActive ? theme.ink : surfaces.border,
                  backgroundColor: isActive ? surfaces.well : surfaces.card,
                  paddingHorizontal: dp(10),
                },
              ]}
              testID={`${testID}-${choice.key || 'all'}`}
            >
              <ModuleText
                token="button"
                color={isActive ? theme.ink : moduleNeutrals.textSecondary}
              >
                {choice.label}
              </ModuleText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  /*
    `wrap` is what lets a row of chips become two rows on a narrow screen instead of overflowing.
    With a width bound now in force, a chip that wraps still carries its full 44 dp with it.
  */
  choices: { flexDirection: 'row', flexWrap: 'wrap' },
  choice: { alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
});
