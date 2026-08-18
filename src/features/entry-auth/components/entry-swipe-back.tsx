import { useMemo, useState } from 'react';
import { Animated, PanResponder, StyleSheet, type PanResponderGestureState } from 'react-native';

import { useEntryStepNavigation } from '../entry-steps';

/**
 * Horizontal travel, in px, before the gesture is taken from its children.
 *
 * Deliberately small but non-zero: zero would claim the very first pixel of every touch and break
 * buttons, while a large value makes the swipe feel dead before it starts.
 */
const CLAIM_DX = 12;

/** Travel that counts as a committed swipe on release. */
const COMMIT_DX = 64;

/** Velocity that commits a shorter, faster flick. */
const COMMIT_VX = 0.35;

/**
 * How much more horizontal than vertical the movement must be.
 *
 * This is what keeps the swipe from fighting the forms' vertical `ScrollView`. The responder is
 * only claimed on a clearly sideways drag, and because the child scroll view is asked first, a
 * vertical drag is already its own before this component is consulted.
 */
const HORIZONTAL_DOMINANCE = 1.6;

/** Fraction of the finger's travel the page actually moves — a hint, not a drag. */
const FOLLOW_RATIO = 0.3;

/**
 * The part of the gesture these decisions depend on.
 *
 * Narrower than `PanResponderGestureState` so the predicates below can be exercised with plain
 * objects: PanResponder computes its own gesture state from touch history, which cannot be
 * synthesised in a test environment, so the thresholds are tested directly instead.
 */
export type SwipeGesture = Pick<PanResponderGestureState, 'dx' | 'dy' | 'vx'>;

/** Rightward, and decisively sideways. Leftward drags are never claimed. */
export function isBackSwipe(gesture: SwipeGesture): boolean {
  return gesture.dx > CLAIM_DX && gesture.dx > Math.abs(gesture.dy) * HORIZONTAL_DOMINANCE;
}

/** Whether a released gesture went far enough, or fast enough, to count as going back. */
export function isCommittedSwipe(gesture: SwipeGesture): boolean {
  return gesture.dx >= COMMIT_DX || (gesture.dx > CLAIM_DX && gesture.vx >= COMMIT_VX);
}

export type EntrySwipeBackProps = {
  /** The active step's dot index; see entryStepIndex. */
  readonly activeIndex: number;
  readonly children: React.ReactNode;
  readonly testID?: string;
};

/**
 * Swipe right to return to the previous entry step.
 *
 * ── Why PanResponder and not react-native-gesture-handler ───────────────────
 * `gestureEnabled` on the native stack is iOS-only — react-native-screens marks it `@platform ios`
 * and the v57 docs say "Only supported on iOS" — so it does nothing on Android, which is the
 * primary test device. The alternative, gesture-handler's `Gesture.Pan`, needs a
 * `GestureHandlerRootView` at the app root; nothing in the app mounts one today, and adding one
 * would put a new wrapper above the locked Main Home tree for the sake of one flow. PanResponder
 * is core React Native, behaves identically on both platforms, and stays contained to this file.
 *
 * On the first step there is nothing behind, so no responder is attached at all rather than one
 * that claims gestures and then declines to act on them.
 */
export function EntrySwipeBack({ activeIndex, children, testID }: EntrySwipeBackProps) {
  const { goBack } = useEntryStepNavigation(activeIndex);

  if (goBack === undefined) {
    return <>{children}</>;
  }

  return (
    <SwipeBackSurface onSwipeBack={goBack} testID={testID}>
      {children}
    </SwipeBackSurface>
  );
}

type SwipeBackSurfaceProps = {
  readonly onSwipeBack: () => void;
  readonly children: React.ReactNode;
  readonly testID?: string;
};

/**
 * The gesture surface itself, split out so `onSwipeBack` is always defined.
 *
 * The page follows the finger at a third of its travel. Without that feedback the gesture is
 * invisible until it completes, which reads as an unresponsive screen rather than a swipe.
 *
 * The responder closes over `onSwipeBack` directly and is rebuilt when it changes. A ref would
 * avoid the rebuild, but reading `ref.current` during render is exactly what the react-hooks rules
 * forbid under the React Compiler — and `onSwipeBack` only changes when the route or step changes,
 * which cannot happen mid-gesture.
 */
function SwipeBackSurface({ onSwipeBack, children, testID }: SwipeBackSurfaceProps) {
  // A state initialiser rather than `useRef(...).current`, which also reads a ref during render.
  const [translateX] = useState(() => new Animated.Value(0));

  const responder = useMemo(() => {
    const springBack = () => {
      Animated.spring(translateX, {
        toValue: 0,
        useNativeDriver: true,
        bounciness: 0,
      }).start();
    };

    return PanResponder.create({
      // Never claimed on touch-down: that is a press, and buttons need it.
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gesture) => isBackSwipe(gesture),
      onPanResponderMove: (_, gesture) => {
        // Clamped at zero so a leftward drag after claiming cannot pull the page off-screen.
        translateX.setValue(Math.max(0, gesture.dx * FOLLOW_RATIO));
      },
      // Having decided the gesture is horizontal, do not hand it to a scroll view mid-swipe.
      onPanResponderTerminationRequest: () => false,
      onPanResponderRelease: (_, gesture) => {
        if (isCommittedSwipe(gesture)) {
          // Reset before navigating: this view is reused for the screen that replaces it.
          translateX.setValue(0);
          onSwipeBack();
          return;
        }
        springBack();
      },
      onPanResponderTerminate: springBack,
    });
  }, [translateX, onSwipeBack]);

  return (
    <Animated.View
      style={[styles.fill, { transform: [{ translateX }] }]}
      testID={testID}
      {...responder.panHandlers}
    >
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
});
