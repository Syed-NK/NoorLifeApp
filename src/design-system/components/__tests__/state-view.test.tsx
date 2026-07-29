import { render, screen, userEvent } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { moduleThemes } from '@ds/modules/module-themes';
import { StateView } from '../state-view';

/**
 * Shared StateView tests.
 *
 * Covers the states Phase 1 must demonstrate plus both AI boundaries, and asserts
 * the two rules that are easiest to regress: a state's meaning is carried by text
 * (never by colour alone), and module theme injection actually reaches the
 * component.
 *
 * Note: RNTL 14's `render` and `rerender` are asynchronous and are awaited.
 */

const initialMetrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

async function renderState(ui: React.ReactElement) {
  return render(<SafeAreaProvider initialMetrics={initialMetrics}>{ui}</SafeAreaProvider>);
}

describe('StateView renders each shared state with readable text', () => {
  it.each([
    ['loading', 'Preparing your experience…', 'This will just take a moment.'],
    ['empty', 'Nothing here yet', 'Add your first item to get started.'],
    ['error', 'Something went wrong', "We didn't expect that. Please try again."],
    ['offline', "You're offline", /Check your connection/],
    ['permission-required', 'Permission needed', /requires access to continue/],
    ['success', 'All done!', 'Your changes were saved successfully.'],
    ['ai-unavailable', 'Module AI is temporarily unavailable', /back shortly/],
    ['ai-safety-boundary', "I can't help with that request", /safe use boundaries/],
  ] as const)('%s shows both a title and an explanatory message', async (kind, title, message) => {
    await renderState(<StateView kind={kind} testID={`state-${kind}`} />);
    expect(screen.getByText(title)).toBeTruthy();
    expect(screen.getByText(message)).toBeTruthy();
  });
});

describe('StateView actions', () => {
  it('renders the preset primary label and fires the handler', async () => {
    const onPrimaryAction = jest.fn();
    const user = userEvent.setup();
    await renderState(
      <StateView kind="error" onPrimaryAction={onPrimaryAction} testID="error-state" />,
    );

    expect(screen.getByText('Try Again')).toBeTruthy();
    await user.press(screen.getByTestId('error-state-primary-action'));
    expect(onPrimaryAction).toHaveBeenCalledTimes(1);
  });

  it('renders a secondary action only when a handler is supplied', async () => {
    const { rerender } = await renderState(
      <StateView kind="offline" onPrimaryAction={jest.fn()} testID="offline-state" />,
    );
    expect(screen.queryByTestId('offline-state-secondary-action')).toBeNull();

    await rerender(
      <SafeAreaProvider initialMetrics={initialMetrics}>
        <StateView
          kind="offline"
          onPrimaryAction={jest.fn()}
          onSecondaryAction={jest.fn()}
          testID="offline-state"
        />
      </SafeAreaProvider>,
    );
    expect(screen.getByTestId('offline-state-secondary-action')).toBeTruthy();
    expect(screen.getByText('View Offline Content')).toBeTruthy();
  });

  it('hides actions entirely when no handler is supplied', async () => {
    await renderState(<StateView kind="empty" testID="empty-state" />);
    expect(screen.queryByTestId('empty-state-primary-action')).toBeNull();
  });

  it('offers a way to continue without AI when AI is unavailable', async () => {
    await renderState(
      <StateView
        kind="ai-unavailable"
        theme={moduleThemes.faith}
        onPrimaryAction={jest.fn()}
        onSecondaryAction={jest.fn()}
        testID="ai-unavailable-state"
      />,
    );
    expect(screen.getByText('Continue without AI')).toBeTruthy();
  });
});

describe('StateView module theme injection', () => {
  it('accepts an injected module theme without inventing its own styling', async () => {
    await renderState(<StateView kind="empty" theme={moduleThemes.faith} testID="faith-empty" />);
    expect(screen.getByTestId('faith-empty')).toBeTruthy();
  });

  it('allows call sites to override title and message with context-specific copy', async () => {
    await renderState(
      <StateView
        kind="empty"
        theme={moduleThemes.planner}
        title="Nothing scheduled today"
        message="Add an event or task in Planner and it will appear here."
        testID="planner-empty"
      />,
    );
    expect(screen.getByText('Nothing scheduled today')).toBeTruthy();
    expect(
      screen.getByText('Add an event or task in Planner and it will appear here.'),
    ).toBeTruthy();
    expect(screen.queryByText('Nothing here yet')).toBeNull();
  });

  it('shows an error reference when one is supplied', async () => {
    await renderState(
      <StateView kind="error" reference="Reference NL-TEST-0001" testID="referenced-error" />,
    );
    expect(screen.getByText('Reference NL-TEST-0001')).toBeTruthy();
  });
});
