import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AuthScaffold } from '@features/entry-auth/components/auth-scaffold';
import { useEntryAuthMetrics } from '@features/entry-auth/use-entry-auth-metrics';

import { PROFILE_LAYOUT } from '../profile-metrics';
import { ProfileHeader } from './profile-header';

export type ProfileDetailScaffoldProps = {
  /** The centred header title. Also the screen's heading for assistive technology. */
  readonly title: string;
  /** Returns to compact Profile Home — never to Main Home. */
  readonly onBack: () => void;
  /** Spoken label for Back. Detail screens say where it goes. */
  readonly backLabel: string;
  /** Offered only where a help destination genuinely exists for this screen. */
  readonly onHelp?: () => void;
  readonly children: React.ReactNode;
  /**
   * Pinned below the scroll area.
   *
   * For a screen with **no keyboard**, where a primary action should stay put while the content
   * scrolls. A screen with a text field must put its action in `children` instead — see the note on
   * the keyboard below.
   */
  readonly footer?: React.ReactNode;
  readonly testID: string;
};

/**
 * The shell every Profile detail screen is built on.
 *
 * ── What it inherits, rather than restates ──────────────────────────────────
 * The soft-mint page, both safe areas, the 16 dp side padding and the 393 dp capped content column
 * all come from `AuthScaffold` — the same code the approved entry screens use. The header is
 * `ProfileHeader`, the same component compact Profile Home draws, so Back and the centred title are
 * identical across Profile and its children rather than two designs kept in sync by hand.
 *
 * There is deliberately no second header here. A detail screen that wanted a different bar would be
 * a second design to review, and the brief rules that out.
 *
 * ── Keyboard ────────────────────────────────────────────────────────────────
 * `KeyboardAvoidingView` shrinks the available height and the `ScrollView` inside moves the focused
 * field up past the keyboard. `keyboardShouldPersistTaps="handled"` is what stops the first tap on a
 * control being consumed dismissing the keyboard — without it, saving takes two taps.
 *
 * A screen with a text field must therefore keep its primary action **in the scrolling content**,
 * not in `footer`. The device pass proved why: under edge-to-edge the avoiding view does not shrink
 * by quite the full keyboard height, so a pinned action ends up clipped by the top row of keys —
 * first half-hidden, then still overlapping after the padding was corrected. Inside the scroll area
 * there is no geometry to get wrong, which is also exactly how the approved Sign In screen is built.
 *
 * ── Scrolling ───────────────────────────────────────────────────────────────
 * Always on, unlike Profile Home's measured switch. These screens are content-led rather than
 * budgeted to a single viewport, so the honest default is that a larger OS text size or a shorter
 * device expands the page. At the reference metrics there is nothing to scroll to and the page does
 * not move; nothing is ever clipped.
 */
export function ProfileDetailScaffold({
  title,
  onBack,
  backLabel,
  onHelp,
  children,
  footer,
  testID,
}: ProfileDetailScaffoldProps) {
  const { dp } = useEntryAuthMetrics();
  const insets = useSafeAreaInsets();

  return (
    <AuthScaffold testID={testID}>
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        // Identified so a test can assert that the footer is *inside* it — see the note on `footer`.
        testID={`${testID}-keyboard-avoider`}
      >
        <ScrollView
          style={styles.fill}
          contentContainerStyle={{
            rowGap: dp(PROFILE_LAYOUT.sectionGap),
            // Only the footerless case needs the safe-area inset here; with a footer the inset
            // belongs to the footer, which is what actually sits nearest the gesture bar.
            paddingBottom:
              (footer === undefined ? insets.bottom : 0) + dp(PROFILE_LAYOUT.bottomPadding),
          }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          testID={`${testID}-scroll`}
        >
          <ProfileHeader
            title={title}
            onBack={onBack}
            backLabel={backLabel}
            {...(onHelp === undefined ? {} : { onHelp })}
            testID={`${testID}-header`}
          />
          <View style={{ rowGap: dp(PROFILE_LAYOUT.sectionGap) }}>{children}</View>
        </ScrollView>

        {footer === undefined ? null : (
          <View
            style={{
              // The inset is added to a fixed margin rather than replacing it, so the action never
              // sits flush against the gesture bar on a device that has one.
              paddingBottom: insets.bottom + dp(PROFILE_LAYOUT.bottomPadding),
              paddingTop: dp(8),
            }}
            testID={`${testID}-footer`}
          >
            {footer}
          </View>
        )}
      </KeyboardAvoidingView>
    </AuthScaffold>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
});
