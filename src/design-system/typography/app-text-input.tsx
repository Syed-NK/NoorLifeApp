import { forwardRef } from 'react';
import {
  StyleSheet,
  TextInput,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
} from 'react-native';

import { fontFamilies, type FontWeightToken } from '@ds/tokens';

/**
 * The imperative handle an `AppTextInput` ref receives.
 *
 * It is the underlying react-native `TextInput` instance — `focus()`, `blur()` and `clear()` all
 * behave exactly as they did before this wrapper existed. It is re-exported here so a call site that
 * needs a ref never has to import `TextInput` itself, which is what lets the lint rule forbidding
 * that import stay absolute rather than carrying a per-file exception.
 */
export type AppTextInputHandle = TextInput;

export type AppTextInputProps = Omit<TextInputProps, 'style'> & {
  /**
   * Which Poppins face the typed value uses. Regular for prose, and that is almost
   * always right — an input is the user's text, not the app's emphasis.
   */
  readonly weight?: FontWeightToken;
  readonly style?: StyleProp<TextStyle>;
};

/**
 * The only text-input primitive in NoorLife.
 *
 * `AppText` and its per-surface siblings resolve `fontFamily` from a type token, so every string the
 * app *displays* is Poppins. `TextInput` is a separate component that none of them wrap, so until
 * this existed each input had to remember the family by hand — and 26 of 31 did not, leaving the
 * text the user typed in Roboto on Android and SF on iOS while the label directly above it was
 * Poppins. Components must not use `TextInput` from react-native directly.
 *
 * ── Why the face goes underneath the caller's style ────────────────────────
 * `face` is the *first* entry in the style array, so a call site's own `fontSize`, `color`,
 * `minHeight` and padding all still win. That is deliberate: this component exists to correct a
 * typeface, and inputs carry sizes that were measured against their own geometry — several use
 * 14 dp where their module ramp's `body` is 12.5 dp, which is the spec's minimum body size and not
 * this component's business to re-ramp. Adopting it therefore changes what an input is drawn *with*
 * and nothing about how large it is. A call site that genuinely needs a heavier face passes
 * `weight` rather than reaching for `fontFamily`.
 *
 * The family — never `fontWeight` — is what selects a face: a numeric weight makes Android
 * synthesise a fake bold instead of loading the registered file. See `fonts.ts`.
 *
 * `allowFontScaling` is left at React Native's default of true. An input must honour the OS text
 * size; where a control's geometry cannot absorb unlimited growth the call site caps the multiplier
 * rather than switching scaling off.
 */
export const AppTextInput = forwardRef<TextInput, AppTextInputProps>(function AppTextInput(
  { weight = 'regular', style, ...rest },
  ref,
) {
  return <TextInput ref={ref} {...rest} style={[faces[weight], style]} />;
});

const faces = StyleSheet.create({
  regular: { fontFamily: fontFamilies.regular },
  medium: { fontFamily: fontFamilies.medium },
  semiBold: { fontFamily: fontFamilies.semiBold },
  bold: { fontFamily: fontFamilies.bold },
}) satisfies Record<FontWeightToken, TextStyle>;
