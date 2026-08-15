import { render, screen } from '@testing-library/react-native';
import React from 'react';

import { FaithResourceView, FaithScreen } from '../components/faith-screen';
import type { FaithErrorCode } from '../data/faith-result';
import type { UseFaithResource } from '../hooks/use-faith-resource';

/**
 * **An error state may not assert a cause NoorLife has not established.**
 *
 * ── The defect, as it was seen ──────────────────────────────────────────────
 * Every `error` code rendered the Faith module's default copy: *"Couldn't load your Faith data. The
 * connection dropped on our side."*, under a **Try again** button. Found on the emulator, on a
 * release build, on a signed-out install: opening the Qur'an list produced a claim that NoorLife's
 * server connection had dropped. Nothing had dropped. There was no session, the adapter answered
 * `unauthorized`, and the screen reported an outage that never happened.
 *
 * ── Why this belongs with the fabrication rules rather than beside them ─────
 * The module's whole discipline is that it does not state what it has not checked — no unverified
 * narration, no invented prayer time, no fabricated bearing. A diagnosis is a statement of fact
 * about the world too, and "the connection dropped on our side" is one of the more consequential
 * ones available: it is unfalsifiable from the user's chair, it tells them their own setup is fine
 * when the actual remedy is theirs to apply, and it spends NoorLife's credibility on a fault that
 * did not occur.
 *
 * `not-configured` is the sharper case, because the rule was already written down. `FaithErrorCode`
 * defines it as "this build has no backend" and says in as many words that "a screen that said 'try
 * again' would be advising a user to retry something that cannot succeed until somebody sets an
 * environment variable". The definition said no retry; the renderer drew one anyway. A rule stated
 * only in a comment is a rule the renderer can contradict, which is what these cases change.
 *
 * ── What is asserted, and what deliberately is not ──────────────────────────
 * The exact wording is not asserted — copy is allowed to improve. What is asserted is the pair of
 * properties that make the wording honest: a terminal code offers **no action**, and no code invents
 * a **connection or server fault** it has not established. A future rewrite that keeps both stays
 * green; one that reinstates "try again" on an unretryable state, or blames the network for a
 * missing session, does not.
 */

/** A settled resource holding one error code, and nothing else. */
function erroredResource(code: FaithErrorCode): UseFaithResource<string> {
  return {
    status: 'settled',
    result: { kind: 'error', code },
    reload: () => undefined,
    refreshing: false,
  } as UseFaithResource<string>;
}

async function renderError(code: FaithErrorCode): Promise<typeof screen> {
  await render(
    <FaithScreen title="Qur’an" activeKey="quran" testID="probe-screen">
      <FaithResourceView
        resource={erroredResource(code)}
        empty={{ title: 'Nothing', body: 'Nothing' }}
        testID="probe"
      >
        {(value) => <>{value}</>}
      </FaithResourceView>
    </FaithScreen>,
  );
  return screen;
}

/** Language that blames a connection, a server or NoorLife's own infrastructure. */
const BLAMES_THE_NETWORK = /connection dropped|on our side|server (error|fault)|try again later/i;

/**
 * The codes that describe a **settled fact about this build**, not a transient failure.
 *
 * Neither can be changed by the user or by waiting, so neither may offer an action.
 */
const TERMINAL_CODES: readonly FaithErrorCode[] = ['not-configured', 'unsupported'];

/** The codes where a retry genuinely can succeed, so the retryable copy is true. */
const RETRYABLE_CODES: readonly FaithErrorCode[] = [
  'unavailable',
  'timeout',
  'rate-limited',
  'not-found',
  'unknown',
];

describe('a terminal error offers no action it cannot honour', () => {
  it.each(TERMINAL_CODES)('renders %s as a locked state with no retry', async (code) => {
    const view = await renderError(code);

    // The terminal state this module already uses for Hadith, Duas and Mosques.
    expect(view.getByTestId('probe-locked')).toBeTruthy();
    // And therefore no retryable error state, which is where the button lives.
    expect(view.queryByTestId('probe-error')).toBeNull();
    expect(view.queryByText(/try again/i)).toBeNull();
  });

  it.each(TERMINAL_CODES)('does not blame the network for %s', async (code) => {
    const view = await renderError(code);
    const spoken = String(view.getByTestId('probe-locked').props.accessibilityLabel);
    expect(spoken).not.toMatch(BLAMES_THE_NETWORK);
  });
});

describe('a missing session is reported as a missing session', () => {
  it('names the account, not an outage', async () => {
    const view = await renderError('unauthorized');

    expect(view.getByTestId('probe-error')).toBeTruthy();
    /*
      `getAllByText`, because the state says it twice on purpose: the title names the remedy and the
      body explains it. Asserting a single match would make the test fail on a state that is *more*
      explicit, which is the wrong direction to constrain this in.
    */
    expect(view.getAllByText(/sign in/i).length).toBeGreaterThan(0);
    // …and the invented cause is absent.
    expect(view.queryByText(BLAMES_THE_NETWORK)).toBeNull();
  });

  it('keeps a retry, because signing in makes one succeed', async () => {
    const view = await renderError('unauthorized');
    expect(view.queryByTestId('probe-locked')).toBeNull();
  });
});

describe('a genuinely transient failure keeps the retryable copy', () => {
  it.each(RETRYABLE_CODES)('renders %s as a retryable error', async (code) => {
    const view = await renderError(code);

    /*
      Asserted so the fix above cannot quietly turn every failure terminal. A timeout *is* worth
      retrying, and a state that refused to offer one would be the opposite error — accurate about
      the cause and useless about the remedy.
    */
    expect(view.getByTestId('probe-error')).toBeTruthy();
    expect(view.queryByTestId('probe-locked')).toBeNull();
  });
});
