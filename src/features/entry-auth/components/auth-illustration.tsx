import { Image } from 'expo-image';
import { StyleSheet, View, type ImageSourcePropType, type StyleProp, type ViewStyle } from 'react-native';

export type AuthIllustrationProps = {
  readonly source: ImageSourcePropType;
  /** Announced to a screen reader; the artwork is meaningful, not purely decorative. */
  readonly accessibilityLabel: string;
  readonly style?: StyleProp<ViewStyle>;
  readonly testID?: string;
};

/**
 * Approved PNG artwork inside a flexible area.
 *
 * Always `contain`: the phase prompt requires aspect ratio be preserved and forbids cropping
 * faces, the robot, pictograms or the wordmark. `contain` inside a flex box means the artwork
 * shrinks to whatever vertical space is left after the fixed text and controls are laid out, so
 * a shorter device loses illustration size rather than clipping a face — and nothing scales
 * *up* past its natural size to fill a tall one.
 */
export function AuthIllustration({
  source,
  accessibilityLabel,
  style,
  testID,
}: AuthIllustrationProps) {
  return (
    <View style={[styles.frame, style]} testID={testID}>
      <Image
        source={source}
        style={styles.image}
        contentFit="contain"
        accessible
        accessibilityRole="image"
        accessibilityLabel={accessibilityLabel}
        testID={`${testID ?? 'auth-illustration'}-image`}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    // The artwork must never be the reason the screen scrolls; it yields space instead.
    minHeight: 0,
  },
  image: {
    width: '100%',
    height: '100%',
  },
});
