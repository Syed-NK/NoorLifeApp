import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as Clipboard from 'expo-clipboard';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';

import { legalConfig, supportConfig } from '@shared/config/app-config';
import { warmUpFirstMount } from '@/test-support/mock-latency-timers';

import { mockRouter } from '../../../../jest.setup';
import { helpCopy } from '../help-copy';
import { helpFaq } from '../help-faq';
import { HelpSupportScreen } from '../screens/help-support-screen';

/**
 * Help & Support — the answers, the mail draft, the two policy links, and the version.
 *
 * ── Why the host boundaries are mocked and nothing else is ──────────────────
 * `Linking` and `WebBrowser` are the two places this screen leaves the application, and they are
 * exactly what a test cannot let run. Everything above them — which URL is formed, what goes in a
 * mail body, what happens when there is no mail app — is this project's own code and runs for
 * real.
 *
 * Real timers, with only the first mount warmed: this screen resolves through promise chains rather
 * than timers, and `waitFor` under fake timers exhausts its simulated budget before they settle.
 */
warmUpFirstMount(() => renderHelp());

jest.mock('expo-linking', () => ({
  canOpenURL: jest.fn(() => Promise.resolve(true)),
  openURL: jest.fn(() => Promise.resolve(true)),
  openSettings: jest.fn(() => Promise.resolve()),
}));

jest.mock('expo-web-browser', () => ({
  openBrowserAsync: jest.fn(() => Promise.resolve({ type: 'opened' })),
}));

const canOpenURL = Linking.canOpenURL as jest.MockedFunction<typeof Linking.canOpenURL>;
const openURL = Linking.openURL as jest.MockedFunction<typeof Linking.openURL>;
const openBrowserAsync = WebBrowser.openBrowserAsync as jest.MockedFunction<
  typeof WebBrowser.openBrowserAsync
>;

async function renderHelp() {
  await render(<HelpSupportScreen />);
  await waitFor(() => expect(screen.getByTestId('help-support')).toBeTruthy());
}

/** The `mailto:` this screen last handed to the device, decoded back into its parts. */
function lastMailDraft() {
  const url = String(openURL.mock.calls.at(-1)?.[0] ?? '');
  const [address, query = ''] = url.replace('mailto:', '').split('?');
  const params = new URLSearchParams(query);
  return {
    address,
    subject: params.get('subject') ?? '',
    body: params.get('body') ?? '',
  };
}

beforeEach(() => {
  canOpenURL.mockReset().mockResolvedValue(true);
  openURL.mockReset().mockResolvedValue(true);
  openBrowserAsync.mockReset().mockResolvedValue({ type: 'opened' } as never);
});

describe('the Help Center', () => {
  it('answers the six questions the brief names', async () => {
    await renderHelp();

    for (const entry of helpFaq({ developmentNotes: false })) {
      expect(screen.getByTestId(`${entry.testID}-question`)).toHaveTextContent(entry.question);
    }
  });

  it('keeps answers collapsed until asked, and announces the state', async () => {
    await renderHelp();

    const toggle = screen.getByTestId('help-faq-free-plan-toggle');
    expect(toggle.props.accessibilityState.expanded).toBe(false);
    expect(screen.queryByTestId('help-faq-free-plan-answer')).toBeNull();

    await fireEvent.press(toggle);

    expect(await screen.findByTestId('help-faq-free-plan-answer')).toBeTruthy();
    expect(screen.getByTestId('help-faq-free-plan-toggle').props.accessibilityState.expanded).toBe(
      true,
    );
  });

  it('matches the Faith, Free, Premium and Noor AI rules the app enforces', async () => {
    await renderHelp();

    await fireEvent.press(screen.getByTestId('help-faq-free-plan-toggle'));
    expect(screen.getByTestId('help-faq-free-plan-answer')).toHaveTextContent(
      /Faith is always free/,
    );

    await fireEvent.press(screen.getByTestId('help-faq-locked-modules-toggle'));
    // Six paid modules — derived from PREMIUM_MODULE_IDS, not typed into the answer.
    expect(screen.getByTestId('help-faq-locked-modules-answer')).toHaveTextContent(
      /Premium unlocks the other 6 modules/,
    );

    await fireEvent.press(screen.getByTestId('help-faq-noor-ai-limits-toggle'));
    const noorAi = screen.getByTestId('help-faq-noor-ai-limits-answer');
    expect(noorAi).toHaveTextContent(/not a general chatbot/);
    expect(noorAi).toHaveTextContent(/without your permission/);
  });
});

describe('Contact Support', () => {
  it('uses the centralized address rather than a literal of its own', async () => {
    await renderHelp();

    expect(screen.getByTestId('help-support-email-value')).toHaveTextContent(supportConfig.email);
  });

  it('forms a correct mail draft for Email Support', async () => {
    await renderHelp();
    await fireEvent.press(screen.getByTestId('help-support-email-action'));

    await waitFor(() => expect(openURL).toHaveBeenCalled());
    const draft = lastMailDraft();
    expect(draft.address).toBe(supportConfig.email);
    expect(draft.subject).toBe(helpCopy.contact.emailSubject);
    expect(draft.body).toContain('App version: 1.0.0');
    expect(draft.body).toContain('Build: 1');
  });

  it('includes only approved diagnostics in a problem report', async () => {
    await renderHelp();
    await fireEvent.press(screen.getByTestId('help-support-report-action'));

    await waitFor(() => expect(openURL).toHaveBeenCalled());
    const { body, subject } = lastMailDraft();

    expect(subject).toBe(helpCopy.contact.reportSubject);
    expect(body).toContain(helpCopy.contact.reportIntro);
    // The four allowed fields, and nothing that identifies the person or their data.
    expect(body).toContain('Platform: ');
    expect(body).toContain('OS version: ');
    for (const forbidden of [
      'jest-seeded-token',
      'accessToken',
      'ahmed@example.com',
      'Ahmed Al-Rashid',
      'test-user-id',
      'supabase',
      'test-publishable-key',
      'localhost:54321',
    ]) {
      expect(body.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });

  it('shows the address when the device has no mail app', async () => {
    canOpenURL.mockResolvedValue(false);
    await renderHelp();
    await fireEvent.press(screen.getByTestId('help-support-email-action'));

    const fallback = await screen.findByTestId('help-support-mail-fallback');
    expect(fallback).toHaveTextContent(new RegExp(supportConfig.email));
    expect(openURL).not.toHaveBeenCalled();

    // And it can be copied, so the user can write to us from somewhere else.
    await fireEvent.press(screen.getByTestId('help-support-copy-email'));
    await waitFor(async () => expect(await Clipboard.getStringAsync()).toBe(supportConfig.email));
  });

  it('reports a composer that failed rather than leaving a dead press', async () => {
    openURL.mockRejectedValue(new Error('no activity found'));
    await renderHelp();
    await fireEvent.press(screen.getByTestId('help-support-email-action'));

    expect(await screen.findByTestId('help-support-mail-fallback')).toHaveTextContent(
      new RegExp(supportConfig.email),
    );
  });
});

describe('Legal', () => {
  it('opens the exact published Privacy Policy URL', async () => {
    await renderHelp();
    await fireEvent.press(screen.getByTestId('help-support-privacy'));

    await waitFor(() =>
      expect(openBrowserAsync).toHaveBeenCalledWith('https://nkdigitalworks.com/privacy'),
    );
    expect(legalConfig.privacyPolicy).toBe('https://nkdigitalworks.com/privacy');
  });

  it('opens the exact published Terms of Service URL', async () => {
    await renderHelp();
    await fireEvent.press(screen.getByTestId('help-support-terms'));

    await waitFor(() =>
      expect(openBrowserAsync).toHaveBeenCalledWith('https://nkdigitalworks.com/terms'),
    );
    expect(legalConfig.termsOfService).toBe('https://nkdigitalworks.com/terms');
  });

  it('offers retry and the URL itself when the link will not open', async () => {
    openBrowserAsync.mockRejectedValue(new Error('no browser'));
    canOpenURL.mockResolvedValue(false);
    await renderHelp();

    await fireEvent.press(screen.getByTestId('help-support-privacy'));

    expect(await screen.findByTestId('help-support-link-failed')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('help-support-copy-link'));
    await waitFor(async () =>
      expect(await Clipboard.getStringAsync()).toBe(legalConfig.privacyPolicy),
    );

    // Retry runs the same attempt again rather than pretending the first one worked.
    openBrowserAsync.mockResolvedValue({ type: 'opened' } as never);
    await fireEvent.press(screen.getByTestId('help-support-link-retry'));
    await waitFor(() => expect(screen.queryByTestId('help-support-link-failed')).toBeNull());
  });
});

describe('About NoorLife', () => {
  it('shows the version and build the installed package reports', async () => {
    await renderHelp();

    // From `expo-application`, stood in at the values the current Android build declares —
    // never a constant typed into the screen.
    expect(screen.getByTestId('help-support-version-value')).toHaveTextContent('1.0.0');
    expect(screen.getByTestId('help-support-build-value')).toHaveTextContent('1');
    expect(screen.getByTestId('help-support-platform-value')).toBeTruthy();
  });

  it('copies only the approved diagnostic fields', async () => {
    await renderHelp();
    await fireEvent.press(screen.getByTestId('help-support-copy-diagnostics'));

    await waitFor(async () => {
      const copied = await Clipboard.getStringAsync();
      expect(copied).toContain('App version: 1.0.0');
      expect(copied).toContain('Build: 1');
      // Exactly four lines. A fifth would mean a field escaped the allow-list.
      expect(copied.split('\n')).toHaveLength(4);
    });

    expect(await screen.findByTestId('help-support-copy-diagnostics-result')).toHaveTextContent(
      helpCopy.about.copied,
    );
  });

  it('opens the company website at its exact URL', async () => {
    await renderHelp();
    await fireEvent.press(screen.getByTestId('help-support-website'));

    await waitFor(() =>
      expect(openBrowserAsync).toHaveBeenCalledWith('https://nkdigitalworks.com'),
    );
    expect(supportConfig.website).toBe('https://nkdigitalworks.com');
  });

  it('shows the current year rather than a year somebody typed', async () => {
    await renderHelp();

    expect(screen.getByTestId('help-support-copyright')).toHaveTextContent(
      new RegExp(`© ${new Date().getFullYear()} `),
    );
  });
});

describe('the header', () => {
  it('returns to Profile', async () => {
    await renderHelp();
    await fireEvent.press(screen.getByTestId('help-support-header-back'));

    expect(mockRouter.dismissTo).toHaveBeenCalledWith('/profile');
  });

  it('offers no Help control that would point at this screen', async () => {
    await renderHelp();

    expect(screen.queryByTestId('help-support-header-help')).toBeNull();
    // The slot is still occupied, so removing the control did not shift the centred title.
    expect(screen.getByTestId('help-support-header-help-spacer')).toBeTruthy();
  });
});
