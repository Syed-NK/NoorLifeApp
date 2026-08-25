import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { AppProviders } from '@application/providers/app-providers';

import type { NoorAIPort, NoorAIResult } from '@services/ai/noor-ai.contract';

import { moduleRegistry } from '../../module-registry';
import { ModuleNoorAIScreen } from '../module-noor-ai-screen';
import { noorAIModulePrivacyLine } from '../noor-ai-chat-copy';

/**
 * **What a module conversation actually does when it is on screen** — issue #64, Stage 1.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * The sibling suite proves the wiring and the absences from the source. These are the three claims
 * only a render can settle: that nothing is asked until the user asks, that a module's name frames
 * the screen and states the privacy line, and that a press sends the typed text with the module's
 * own surface exactly once.
 *
 * Three, and not more, because this project has no React act environment and each case mounts the
 * whole provider stack and module scaffold — after roughly this many such renders in one file the
 * next yields an empty tree. The unknown-module fallback is asserted against `isFrameworkModuleId`
 * in the sibling suite for that reason, which is where the closed set is decided anyway.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** Records every call, so "exactly one request" is countable rather than inferred. */
function recordingPort(
  result: NoorAIResult = { outcome: 'failed', failure: 'network-unavailable' },
) {
  const calls: { message: string; surface: string }[] = [];
  const port: NoorAIPort = {
    ask: async (message, context) => {
      calls.push({ message, surface: context.currentScreen });
      return result;
    },
  };
  return { port, calls };
}

async function settle() {
  await act(async () => {
    for (let i = 0; i < 12; i += 1) {
      await Promise.resolve();
    }
  });
}

describe('a conversation opened from a module', () => {
  it('asks nothing on mount, and frames itself with the module', async () => {
    /*
      The single most important case. A screen that sent an opening question by itself would spend a
      quota reservation and a provider attempt for a question nobody asked — and would do it on every
      visit to six module tabs.
    */
    const { port, calls } = recordingPort();
    const view = await render(
      <AppProviders>
        <ModuleNoorAIScreen moduleId="finance" port={port} />
      </AppProviders>,
    );
    await waitFor(() => expect(screen.getByTestId('noor-ai-chat-composer-input')).toBeTruthy());
    await settle();

    expect(calls).toHaveLength(0);
    expect(view.getByTestId('finance-ai')).toBeTruthy();
    expect(view.getByText(noorAIModulePrivacyLine(moduleRegistry.finance.name))).toBeTruthy();
  });

  it('sends the typed text with the module’s own surface, exactly once per press', async () => {
    /*
      Both halves of Stage 1 in one assertion: what reaches the port is the user's sentence, and the
      module identity travels as the allow-listed surface beside it rather than inside it.

      Pressed twice deliberately. `inFlight` is a ref, so the second press inside the same frame sees
      the first one's mark — the guard this asserts is synchronous, which a `pending` flag could not
      be.
    */
    const { port, calls } = recordingPort({ outcome: 'failed', failure: 'unknown' });
    const view = await render(
      <AppProviders>
        <ModuleNoorAIScreen moduleId="planner" port={port} />
      </AppProviders>,
    );
    await waitFor(() => expect(screen.getByTestId('noor-ai-chat-composer-input')).toBeTruthy());

    const input = view.getByTestId('noor-ai-chat-composer-input');
    await act(async () => {
      fireEvent.changeText(input, 'How do I add a task?');
    });
    const send = view.getByTestId('noor-ai-chat-composer-send');
    await act(async () => {
      fireEvent.press(send);
      fireEvent.press(send);
    });
    await settle();

    expect(calls).toHaveLength(1);
    expect(calls[0]?.message).toBe('How do I add a task?');
    expect(calls[0]?.surface).toBe('/planner');
    /* The module's name is nowhere in the message. */
    expect(calls[0]?.message).not.toMatch(/planner/i);
  });

  it('cannot send an empty question', async () => {
    const { port, calls } = recordingPort();
    const view = await render(
      <AppProviders>
        <ModuleNoorAIScreen moduleId="health" port={port} />
      </AppProviders>,
    );
    await waitFor(() => expect(screen.getByTestId('noor-ai-chat-composer-input')).toBeTruthy());

    await act(async () => {
      fireEvent.press(view.getByTestId('noor-ai-chat-composer-send'));
    });
    await settle();

    expect(calls).toHaveLength(0);
  });
});
