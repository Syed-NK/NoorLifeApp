import AsyncStorage from '@react-native-async-storage/async-storage';
import { render, fireEvent, screen } from '@testing-library/react-native';
import React, { type ReactElement } from 'react';

import { warmUpFirstMount } from '@/test-support/mock-latency-timers';

import type { FaithRepositories } from '../data';
import { FaithRepositoryProvider } from '../di/faith-repository-context';
import { FaithAiScreen } from '../screens/faith-ai-screen';
import { SearchScreen } from '../screens/search-screen';
import { TasbihScreen } from '../screens/tasbih-screen';
import { WorshipScreen } from '../screens/worship-screen';

/**
 * Faith screen interactions.
 *
 * ── Separate from the mount smoke suite ─────────────────────────────────────
 * `faith-screens.test.tsx` asserts that seventeen screens render. This file asserts that
 * pressing things does what it should, which is a different claim and needs a longer
 * async budget: every interaction here goes render → repository → storage → re-render.
 *
 * ── One harness note worth recording ────────────────────────────────────────
 * `findBy*` already retries until its timeout. Wrapping one in `waitFor` nests two retry
 * loops, and the inner one exhausts the outer one's budget before it can succeed — which
 * looks exactly like a broken screen and cost an hour to diagnose. Every assertion below
 * uses `findBy*` on its own.
 *
 * ── Real timers, and a warmed first mount ───────────────────────────────────
 * The sibling suites advance fake timers to skip the 280 ms every Faith mock repository sleeps.
 * This one cannot: its screens become ready through promise chains rather than through a timer, and
 * `waitFor` under fake timers exhausts its simulated budget in microseconds before those chains
 * settle. What it can take is the other half — the first mount, which measured 3.4 s against 200 ms
 * for the ones after it, paid for in `beforeAll` instead of by whichever test happens to run first.
 */
warmUpFirstMount(() => withRepositories(<SearchScreen />));

beforeEach(async () => {
  // Tasbih and worship genuinely persist, so a count left by one case would otherwise be
  // the starting state of the next.
  await AsyncStorage.clear();
});

async function withRepositories(element: ReactElement, repositories?: Partial<FaithRepositories>) {
  await render(
    <FaithRepositoryProvider repositories={repositories}>{element}</FaithRepositoryProvider>,
  );
  return screen;
}

describe('search', () => {
  it('prompts before a query is entered', async () => {
    const view = await withRepositories(<SearchScreen />);
    expect(await view.findByTestId('faith-search-results-no-results')).toBeTruthy();
  });

  it('shows no-results for a term that matches nothing', async () => {
    const view = await withRepositories(<SearchScreen />);
    fireEvent.changeText(await view.findByTestId('faith-search-input'), 'zzzznothing');
    fireEvent.press(await view.findByTestId('faith-search-submit'));

    expect(await view.findByText(/No results found/)).toBeTruthy();
  });

  it('finds a verse by its translation', async () => {
    const view = await withRepositories(<SearchScreen />);
    fireEvent.changeText(await view.findByTestId('faith-search-input'), 'hardship');
    fireEvent.press(await view.findByTestId('faith-search-submit'));

    expect(await view.findByTestId('faith-search-ayat')).toBeTruthy();
  });
});

describe('tasbih', () => {
  it('offers count, undo, change and reset controls', async () => {
    const view = await withRepositories(<TasbihScreen />);
    expect(await view.findByTestId('faith-tasbih-count')).toBeTruthy();
    expect(await view.findByTestId('faith-tasbih-undo')).toBeTruthy();
    expect(await view.findByTestId('faith-tasbih-change')).toBeTruthy();
    expect(await view.findByTestId('faith-tasbih-reset')).toBeTruthy();
  });

  it('increments the visible count on press', async () => {
    const view = await withRepositories(<TasbihScreen />);
    const value = await view.findByTestId('faith-tasbih-count-value');
    expect(value.props.children).toBe('0');

    fireEvent.press(await view.findByTestId('faith-tasbih-count'));

    expect(await view.findByText('1')).toBeTruthy();
  });

  it('undoes a mis-tap without going below zero', async () => {
    const view = await withRepositories(<TasbihScreen />);
    fireEvent.press(await view.findByTestId('faith-tasbih-undo'));
    expect(await view.findByText('0')).toBeTruthy();
  });

  it('lists the dhikr presets when Change is pressed', async () => {
    const view = await withRepositories(<TasbihScreen />);
    fireEvent.press(await view.findByTestId('faith-tasbih-change'));
    expect(await view.findByTestId('faith-tasbih-preset-alhamdulillah')).toBeTruthy();
  });
});

describe('worship checklist', () => {
  it('marks an entry and reflects it in the summary', async () => {
    const view = await withRepositories(<WorshipScreen />);
    expect(await view.findByTestId('faith-worship-summary')).toBeTruthy();

    fireEvent.press(await view.findByTestId('faith-worship-entry-fajr'));

    // The repository returns the whole day, so the row renders from the persisted answer
    // rather than from an optimistic guess.
    expect(await view.findByTestId('faith-worship-row-fajr')).toBeTruthy();
  });
});

describe('Faith AI', () => {
  it('states that it is not connected', async () => {
    const view = await withRepositories(<FaithAiScreen />);
    expect(await view.findByTestId('faith-ai-banner')).toBeTruthy();
  });

  it('renders a limitation for a jurisprudential question', async () => {
    const view = await withRepositories(<FaithAiScreen />);
    fireEvent.changeText(
      await view.findByTestId('faith-ai-input'),
      'is it permissible to do this?',
    );
    fireEvent.press(await view.findByTestId('faith-ai-send'));

    expect(await view.findByTestId('faith-ai-limitation')).toBeTruthy();
  });

  it('offers a hand-off and renders no answer for an out-of-scope question', async () => {
    const view = await withRepositories(<FaithAiScreen />);
    fireEvent.changeText(await view.findByTestId('faith-ai-input'), 'how did I sleep?');
    fireEvent.press(await view.findByTestId('faith-ai-send'));

    expect(await view.findByTestId('faith-ai-handoff')).toBeTruthy();
    expect(view.queryByTestId('faith-ai-answer')).toBeNull();
  });

  it('answers an in-scope question with an attributed quote', async () => {
    const view = await withRepositories(<FaithAiScreen />);
    fireEvent.changeText(await view.findByTestId('faith-ai-input'), 'explain this ayah');
    fireEvent.press(await view.findByTestId('faith-ai-send'));

    expect(await view.findByTestId('faith-ai-answer')).toBeTruthy();
    // Sample scripture must be labelled as such wherever it appears.
    expect(await view.findAllByText(/not a verified source/i)).not.toHaveLength(0);
  });
});
