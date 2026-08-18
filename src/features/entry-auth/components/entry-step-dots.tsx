import { ENTRY_STEP_COUNT, useEntryStepNavigation } from '../entry-steps';
import { ProgressDots } from './progress-dots';

export type EntryStepDotsProps = {
  /** The active step's dot index; see entryStepIndex. */
  readonly activeIndex: number;
  readonly testID?: string;
};

/**
 * The entry sequence's dot row, wired to backward navigation.
 *
 * Every entry screen renders this rather than `ProgressDots` directly, so the count and the tap
 * behaviour are defined once. `ProgressDots` stays presentational and testable on its own.
 */
export function EntryStepDots({ activeIndex, testID }: EntryStepDotsProps) {
  const { goToStep } = useEntryStepNavigation(activeIndex);

  return (
    <ProgressDots
      count={ENTRY_STEP_COUNT}
      activeIndex={activeIndex}
      onSelect={goToStep}
      testID={testID}
    />
  );
}
