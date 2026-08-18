import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet } from 'react-native';

import { AuthScaffold } from './auth-scaffold';
import { useEntryAuthMetrics } from '../use-entry-auth-metrics';

export type AuthFormScaffoldProps = {
  readonly children: React.ReactNode;
  /**
   * Fixed content pinned below the scrolling form.
   *
   * Passed straight through to `AuthScaffold`, which places it *outside* the keyboard-avoiding
   * view. That is deliberate: an opening keyboard shrinks the form and scrolls it, and the footer
   * goes behind the keyboard rather than being dragged up over the fields.
   */
  readonly footer?: React.ReactNode;
  readonly testID?: string;
};

/**
 * The shell for every screen with a keyboard.
 *
 * `KeyboardAvoidingView` shrinks the available height and the `ScrollView` inside lets the fields
 * move up past the keyboard, which together are what keep "content is clipped when the keyboard
 * opens" — a listed rejection gate — from happening. It also covers "reduced-height device": on a
 * short screen the form scrolls instead of being cut off.
 *
 * `keyboardShouldPersistTaps="handled"` matters more than it looks: without it the first tap on a
 * submit button while the keyboard is open is consumed dismissing the keyboard, so the user has to
 * tap twice.
 */
export function AuthFormScaffold({ children, footer, testID }: AuthFormScaffoldProps) {
  const { dp } = useEntryAuthMetrics();

  return (
    <AuthScaffold testID={testID} footer={footer}>
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          style={styles.fill}
          contentContainerStyle={{ paddingBottom: dp(24), gap: dp(16) }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </AuthScaffold>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
});
