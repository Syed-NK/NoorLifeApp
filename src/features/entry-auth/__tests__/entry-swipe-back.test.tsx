import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import {
  EntrySwipeBack,
  isBackSwipe,
  isCommittedSwipe,
  type SwipeGesture,
} from '../components/entry-swipe-back';
import { entryStepIndex } from '../entry-steps';

/**
 * Swipe-back for the entry sequence.
 *
 * The thresholds are asserted directly rather than through a simulated drag: PanResponder derives
 * its gesture state from native touch history, which jsdom has no equivalent of, so firing its
 * handlers with synthetic events would test the fake and not the rules.
 */

const gesture = (over: Partial<SwipeGesture>): SwipeGesture => ({ dx: 0, dy: 0, vx: 0, ...over });

describe('claiming the gesture', () => {
  it('claims a clear rightward drag', () => {
    expect(isBackSwipe(gesture({ dx: 40, dy: 5 }))).toBe(true);
  });

  it('ignores leftward drags entirely', () => {
    // Forward is not a direction this sequence travels, so a left drag must stay with its children.
    expect(isBackSwipe(gesture({ dx: -80, dy: 0 }))).toBe(false);
  });

  it('ignores a vertical drag, so the forms keep scrolling', () => {
    // The regression this guards: a scroll down the Sign Up form reading as a back swipe.
    expect(isBackSwipe(gesture({ dx: 20, dy: 60 }))).toBe(false);
  });

  it('ignores the first few pixels of a touch, so buttons still press', () => {
    expect(isBackSwipe(gesture({ dx: 4, dy: 0 }))).toBe(false);
  });
});

describe('committing the gesture', () => {
  it('commits a long drag', () => {
    expect(isCommittedSwipe(gesture({ dx: 90 }))).toBe(true);
  });

  it('commits a short, fast flick', () => {
    expect(isCommittedSwipe(gesture({ dx: 30, vx: 0.8 }))).toBe(true);
  });

  it('abandons a short, slow drag', () => {
    // Releasing here springs the page back rather than navigating.
    expect(isCommittedSwipe(gesture({ dx: 30, vx: 0.05 }))).toBe(false);
  });
});

describe('EntrySwipeBack', () => {
  it('attaches no gesture on the first step, which has nothing behind it', async () => {
    await render(
      <EntrySwipeBack activeIndex={entryStepIndex.onboardingOne} testID="swipe">
        <Text>panel</Text>
      </EntrySwipeBack>,
    );

    // Children render, but unwrapped — a responder that claims swipes and then declines to act on
    // them would swallow gestures for no reason.
    expect(screen.getByText('panel')).toBeTruthy();
    expect(screen.queryByTestId('swipe')).toBeNull();
  });

  it('wraps later steps in a gesture responder', async () => {
    await render(
      <EntrySwipeBack activeIndex={entryStepIndex.onboardingThree} testID="swipe">
        <Text>form</Text>
      </EntrySwipeBack>,
    );

    const wrapper = screen.getByTestId('swipe');
    expect(wrapper).toBeTruthy();
    expect(typeof wrapper.props.onMoveShouldSetResponder).toBe('function');
    expect(screen.getByText('form')).toBeTruthy();
  });
});
