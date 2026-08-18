import type { StyleProp, ViewStyle } from 'react-native';

import { PrimaryButton, SecondaryButton } from '@ds/components';
import { moduleNeutrals } from '../module-tokens';
import { useModuleTheme } from '../module-context';

/**
 * A design-system button already bound to the active module's palette.
 *
 * ── The defect this exists to make impossible ───────────────────────────────
 * `PrimaryButton` and `SecondaryButton` default their colour to
 * `semanticColors.primary` — `#3157C8`, NoorLife's global royal blue. That default is correct for
 * the entry and auth flows, which are not inside a module. Inside one it is wrong, and wrong
 * *silently*: the button renders, works, meets contrast, and simply belongs to another app. The
 * Prayer Location screen shipped three royal-blue controls on an emerald screen for exactly that
 * reason — nobody passed `color`, so nobody saw a mistake.
 *
 * A module screen should not have to remember. This reads `useModuleTheme()` and binds the fill, the
 * outline and the label for every variant, so the palette follows the module the screen is in and
 * "forgot to pass a colour" is not a state that exists.
 *
 * ── Why it wraps rather than replaces ───────────────────────────────────────
 * Geometry, the 48 dp minimum height, the loading spinner, the disabled treatment, the busy
 * announcement and the press feedback all already live in the shared components and are asserted by
 * their own tests. Re-implementing any of that here would be a second button system that drifts.
 * This adds one thing: which colours.
 */

export type ModuleButtonVariant =
  /** The completion action — "Save location". Filled in the module's accessible fill colour. */
  | 'primary'
  /** A step towards it — "Preview location". Outlined, on the module's own surface. */
  | 'secondary'
  /** Quiet and non-destructive — "Cancel", "Not now". No box, still clearly interactive. */
  | 'tertiary'
  /**
   * Genuinely destructive only.
   *
   * Uses the semantic error token rather than the module's hue, because "delete" must not be
   * expressible in the same colour as "save". Never used for cancellation.
   */
  | 'destructive';

export type ModuleButtonProps = {
  readonly label: string;
  readonly onPress: () => void;
  readonly variant?: ModuleButtonVariant;
  readonly disabled?: boolean;
  /** Primary and destructive only — the shared secondary has no spinner. */
  readonly loading?: boolean;
  /** Defaults to **true**: a module action area is a stack of full-width controls. */
  readonly fullWidth?: boolean;
  readonly accessibilityHint?: string;
  readonly style?: StyleProp<ViewStyle>;
  readonly testID?: string;
};

export function ModuleButton({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  fullWidth = true,
  accessibilityHint,
  style,
  testID,
}: ModuleButtonProps) {
  const theme = useModuleTheme();

  if (variant === 'primary' || variant === 'destructive') {
    return (
      <PrimaryButton
        label={label}
        onPress={onPress}
        /*
          `theme.fill` rather than `theme.primary`: the fill is the hue darkened until white-on-it
          clears 4.5:1, which is the value a filled button carrying a white label needs. The brand
          primary is for decorative surfaces and gradient ends — see `module-tokens.ts`.
        */
        color={variant === 'destructive' ? moduleNeutrals.error : theme.fill}
        textColor={theme.onFill}
        disabled={disabled}
        loading={loading}
        fullWidth={fullWidth}
        {...(accessibilityHint === undefined ? {} : { accessibilityHint })}
        {...(style === undefined ? {} : { style })}
        {...(testID === undefined ? {} : { testID })}
      />
    );
  }

  return (
    <SecondaryButton
      label={label}
      onPress={onPress}
      /*
        `theme.ink` is the hue darkened for *text*, which is what a secondary label and its outline
        both are. `subtle` drops the outline for the tertiary case, so Cancel reads as quiet rather
        than as a second boxed control competing with Save.
      */
      color={theme.ink}
      variant={variant === 'tertiary' ? 'subtle' : 'outline'}
      disabled={disabled}
      fullWidth={fullWidth}
      {...(accessibilityHint === undefined ? {} : { accessibilityHint })}
      {...(style === undefined ? {} : { style })}
      {...(testID === undefined ? {} : { testID })}
    />
  );
}
