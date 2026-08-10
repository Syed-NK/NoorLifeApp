import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { mockRouter } from '../../../../jest.setup';
import { noorAIHomeCopy } from '../noor-ai/noor-ai-view-model';
import { NOOR_AI_CHAT_PATH } from '../noor-ai/noor-ai-chat-routes';
import { ModuleHomeScreen } from '../screens/module-home-screen';

/**
 * Noor AI's home screen offers only what AI-1 can actually serve.
 *
 * ── Why this suite exists ───────────────────────────────────────────────────
 * AI-5's emulator pass on API 36 photographed the home screen and the picture showed five things the
 * build cannot do. The worst was a card headed **Recent Conversations** listing three invented
 * questions with invented timestamps — "How can I improve my productivity? / Yesterday, 9:21 PM" —
 * presented as the user's own history, one tap from a chat surface whose caption reads *"Nothing here
 * is saved."* There is no conversation store: `AI_CONVERSATION_STORAGE_EXISTS` is `false` and
 * persistence is AI-8's.
 *
 * The rest promised module reads Noor AI does not perform: "Explain my progress", "Help me plan",
 * "Review my day", "Balance my week", "Family activity idea", and a microphone that opened a "coming
 * soon" screen while voice input does not exist.
 *
 * §12.8's rule is that AI-5 enables **only capabilities AI-1's server can actually serve**. These
 * tests hold that line by rendering the real screen and refusing the fabrications by name, so
 * restoring any of them fails here.
 */

const FABRICATED_QUESTIONS = [
  'How can I improve my productivity?',
  'Best healthy dinner ideas for family',
  'Plan a balanced weekend schedule',
];

/** The five capability labels that described Noor AI reading module records. */
const MODULE_READ_LABELS = [
  'Explain my progress',
  'Help me plan',
  'Review my day',
  'Balance my week',
  'Family activity idea',
];

async function renderHome() {
  await render(<ModuleHomeScreen moduleId="noor-ai" />);
}

/**
 * The whole rendered tree as text, props included.
 *
 * Serialising rather than collecting only visible strings is deliberate: it also catches a
 * fabrication hidden in an `accessibilityLabel`, which is where the removed conversation rows put
 * their timestamps.
 */
function renderedText(): string {
  return JSON.stringify(screen.toJSON());
}

/** Every pressable control the screen exposes. */
function buttons() {
  return screen.queryAllByRole('button');
}

describe('no fabricated conversation history', () => {
  it('renders no Recent Conversations section', async () => {
    await renderHome();

    expect(screen.queryByTestId('noor-ai-conversations')).toBeNull();
    expect(screen.queryByTestId('noor-ai-conversations-viewall')).toBeNull();
    expect(screen.queryByText(/Recent Conversations/i)).toBeNull();
  });

  it('renders none of the invented questions', async () => {
    await renderHome();

    for (const question of FABRICATED_QUESTIONS) {
      expect(screen.queryByText(question)).toBeNull();
    }
  });

  it('renders no timestamp of any kind', async () => {
    await renderHome();

    const text = renderedText();
    // "Yesterday, 9:21 PM", "May 18, 10:45 AM" — and anything else shaped like a clock or a date.
    expect(text).not.toMatch(/\b\d{1,2}:\d{2}\s?(AM|PM)\b/i);
    expect(text).not.toMatch(/\bYesterday\b/i);
    expect(text).not.toMatch(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+\d{1,2}\b/);
  });

  it('does not replace it with an empty state that still claims a history exists', async () => {
    await renderHome();

    const text = renderedText();
    expect(text).not.toMatch(/no (recent )?conversations/i);
    expect(text).not.toMatch(/history is empty|no saved (answers|questions)/i);
    expect(text).not.toMatch(/your (past|previous) (questions|conversations)/i);
  });

  it('exposes no conversation identifier anywhere on the screen', async () => {
    await renderHome();
    // The chat route's segment is the fixed literal `new`; nothing generates an id.
    expect(renderedText()).not.toMatch(/\b[0-9a-f]{8}-[0-9a-f]{4}/i);
  });
});

describe('no unsupported capability is presented as active', () => {
  it('renders no microphone control while voice input does not exist', async () => {
    await renderHome();

    expect(screen.queryByTestId('noor-ai-ask-mic')).toBeNull();
    expect(screen.queryByLabelText('Ask by voice')).toBeNull();
    expect(renderedText()).not.toMatch(/voice/i);
  });

  it('renders no capability grid and no suggestions section', async () => {
    await renderHome();

    for (const testID of [
      'noor-ai-capabilities',
      'noor-ai-suggestions',
      'noor-ai-suggestions-viewall',
    ]) {
      expect(screen.queryByTestId(testID)).toBeNull();
    }
    expect(screen.queryByText('View All')).toBeNull();
  });

  it('offers nothing whose wording implies Noor AI reads module records', async () => {
    await renderHome();

    for (const label of MODULE_READ_LABELS) {
      expect(screen.queryByText(label)).toBeNull();
    }

    const text = renderedText();
    // No claim to read a day, a week, progress, a family or any module's contents.
    expect(text).not.toMatch(/my progress|your progress/i);
    expect(text).not.toMatch(/today's activities|summary of (today|your day)/i);
    expect(text).not.toMatch(/improve your time|balance my week/i);
    expect(text).not.toMatch(/family activity|meaningful activity/i);
  });

  it('sends nothing to the generic "coming soon" screen', async () => {
    await renderHome();

    // Press every pressable on the screen; none may route to a placeholder destination.
    const pressables = buttons();
    expect(pressables.length).toBeGreaterThan(0);
    for (const pressable of pressables) {
      await fireEvent.press(pressable);
    }

    for (const call of mockRouter.push.mock.calls) {
      expect(JSON.stringify(call[0])).not.toContain('coming-soon');
    }
  });
});

describe('what the screen does still offer', () => {
  it('opens the conversation screen from the field and the send control, and from nothing else', async () => {
    await renderHome();

    await fireEvent.press(screen.getByTestId('noor-ai-ask-field'));
    await fireEvent.press(screen.getByTestId('noor-ai-ask-send'));
    expect(mockRouter.push).toHaveBeenCalledTimes(2);
    expect(mockRouter.push).toHaveBeenNthCalledWith(1, NOOR_AI_CHAT_PATH);
    expect(mockRouter.push).toHaveBeenNthCalledWith(2, NOOR_AI_CHAT_PATH);

    // Every other control on the screen leads somewhere that is not the chat.
    mockRouter.push.mockClear();
    const others = buttons().filter((node) => {
      const label = String(node.props?.accessibilityLabel ?? '');
      return !label.includes('Opens the conversation screen') && label !== 'Ask Noor AI a question';
    });
    for (const node of others) {
      await fireEvent.press(node);
    }
    for (const call of mockRouter.push.mock.calls) {
      expect(call[0]).not.toBe(NOOR_AI_CHAT_PATH);
    }
  });

  it('states the access boundary truthfully and claims no permission management', async () => {
    await renderHome();

    expect(screen.getByTestId('noor-ai-privacy')).toBeTruthy();
    expect(screen.getByText(noorAIHomeCopy.privacy.title)).toBeTruthy();
    expect(screen.getByText(noorAIHomeCopy.privacy.body)).toBeTruthy();

    const text = renderedText();
    // The previous wording promised management that AI-6 has not built.
    expect(text).not.toMatch(/manage your (data|permissions)/i);
    expect(text).not.toMatch(/you control what/i);
    expect(text).not.toMatch(/grant a module|withdraw it/i);
  });

  it('labels the access card as navigation to information, not as a control', async () => {
    await renderHome();

    const label = String(screen.getByTestId('noor-ai-privacy').props.accessibilityLabel ?? '');
    expect(label).toContain(noorAIHomeCopy.privacy.title);
    expect(label).toContain('What Noor AI can access');
  });
});

describe('the correction added no capability of its own', () => {
  it('writes nothing to storage while the home screen renders', async () => {
    const setItem = jest.spyOn(AsyncStorage, 'setItem');
    await renderHome();
    expect(setItem).not.toHaveBeenCalled();
  });

  it('performs no network request while the home screen renders', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch' as never);
    await renderHome();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('keeps the copy free of any capability the server cannot serve', async () => {
    // The view model is now two entries: the ask placeholder and the access boundary.
    expect(Object.keys(noorAIHomeCopy)).toEqual(['prompt', 'privacy']);
  });
});
