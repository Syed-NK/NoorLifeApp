import * as Clipboard from 'expo-clipboard';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';

/**
 * Leaving the application safely: the web, a mail composer, and the device settings screen.
 *
 * ── Why every one of these returns an outcome ───────────────────────────────
 * A link that quietly fails is the defect this module exists to prevent. On a device with no mail
 * application, `Linking.openURL('mailto:…')` rejects and the screen shows nothing — the user
 * presses "Email Support", watches the button flash, and concludes the app is broken. So nothing
 * here throws and nothing here resolves to `void`: each call reports what actually happened, and
 * the caller is obliged to render it.
 *
 * ── Why the web goes through the in-app browser ─────────────────────────────
 * `WebBrowser.openBrowserAsync` opens a Custom Tab on Android and `SFSafariViewController` on iOS
 * — the sandboxed viewers, sharing no cookies or storage with the application, and dismissible
 * back into it. `Linking.openURL` hands the URL to whatever the user's default browser is and
 * loses them to another task. The fallback runs only when the in-app browser is unavailable, which
 * is better than not opening the policy at all.
 *
 * ── Offline ─────────────────────────────────────────────────────────────────
 * There is no connectivity library in this project, so "offline" is not something this service can
 * *detect* — and a guess would be worse than none, since a wrongly-detected offline state hides a
 * link that would have worked. What it can do is make the failure recoverable: the browser reports
 * its own connection error on the page, and the caller offers the URL to copy and a retry. That is
 * why `copyToClipboard` lives here rather than in a screen.
 */

export type LinkOutcome =
  /** Handed to a browser, a mail composer or the settings app. */
  | 'opened'
  /** Nothing on the device can handle it — no mail application, no browser. */
  | 'no-handler'
  /** Something could handle it and the attempt failed anyway. */
  | 'failed';

/** Opens a URL in the in-app browser, falling back to the system handler. */
export async function openExternalUrl(url: string): Promise<LinkOutcome> {
  try {
    await WebBrowser.openBrowserAsync(url);
    return 'opened';
  } catch {
    // The in-app browser is unavailable on this device. Try the system handler before giving up.
  }

  try {
    if (!(await Linking.canOpenURL(url))) {
      return 'no-handler';
    }
    await Linking.openURL(url);
    return 'opened';
  } catch {
    return 'failed';
  }
}

export type EmailDraft = {
  readonly to: string;
  readonly subject: string;
  /**
   * The body.
   *
   * Composed by the caller from `formatDiagnostics` and nothing else. This service does not read
   * the session, the profile or any module, so there is no path by which personal data could be
   * appended to a draft here.
   */
  readonly body: string;
};

/**
 * Opens the device's mail composer with a pre-filled draft.
 *
 * Nothing is sent: `mailto:` hands the draft to the user's mail application, where they read it,
 * edit it and decide. There is no support backend and this does not post anywhere.
 */
export async function openEmailDraft(draft: EmailDraft): Promise<LinkOutcome> {
  const url = `mailto:${draft.to}?subject=${encodeURIComponent(
    draft.subject,
  )}&body=${encodeURIComponent(draft.body)}`;

  try {
    // Checked first: on a device with no mail application `openURL` rejects, and the reason is
    // worth distinguishing from a composer that opened and then failed.
    if (!(await Linking.canOpenURL(url))) {
      return 'no-handler';
    }
    await Linking.openURL(url);
    return 'opened';
  } catch {
    return 'failed';
  }
}

/** Opens the operating system's settings page for NoorLife. */
export async function openDeviceSettings(): Promise<LinkOutcome> {
  try {
    await Linking.openSettings();
    return 'opened';
  } catch {
    return 'no-handler';
  }
}

/** Copies text to the clipboard, reporting whether it landed. */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await Clipboard.setStringAsync(text);
    return true;
  } catch {
    return false;
  }
}
