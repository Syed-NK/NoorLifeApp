import { Share } from 'react-native';

import type { AyahText, AyahTranslation } from '../../data/quran-content.repository';

/**
 * Sharing one verse out of the app, through the platform's own share sheet.
 *
 * ── The Arabic is passed through, byte for byte ─────────────────────────────
 * `text.arabic` is interpolated and nothing else happens to it: no `trim`, no `normalize`, no
 * `replace`, no line-wrapping and no stripping of the pause marks. This is the second place in the
 * module where Qur'anic Arabic leaves the repository and reaches a renderer — `ArabicText` is the
 * first — and it is the place where a well-meant tidy-up would be invisible in review, because the
 * result only ever appears inside somebody else's messaging app. `preservesScripture` below is the
 * executable statement of that, and it is asserted rather than trusted.
 *
 * ── Nothing generated is added ──────────────────────────────────────────────
 * The composed message carries the scripture, the active translation, the verse's own reference and
 * the two attributions. There is no summary, no explanation and no commentary — Faith AI's output
 * cannot reach this function, and there is no parameter through which it could. A share that
 * appended a generated gloss would be presenting NoorLife's words as part of the verse in a context
 * where the recipient has no way to tell the two apart.
 *
 * ── Attribution is required, not decorative ─────────────────────────────────
 * A translation is one person's reading of the meaning, and the licence the app holds it under is
 * about naming that person. So when a translation is shared its translator and edition go with it,
 * and the source the scripture itself came from is named as well. A verse whose translation could
 * not be resolved shares the Arabic alone rather than shipping an unattributed rendering.
 */

export type VerseShareInput = {
  readonly surahName: string;
  readonly text: AyahText;
  readonly translation: AyahTranslation | null;
};

/** How the app names itself in a shared message. One line, no marketing. */
const APP_CREDIT = 'Shared from NoorLife';

/**
 * Whose translation this is, in the form the share message carries it.
 *
 * `attribution` is the translator and is required of the approved adapter; `edition` is the
 * edition's own title where the source gives one. Neither is invented when absent — the line says
 * less rather than crediting a translator it does not know.
 */
export function translationCreditLine(translation: AyahTranslation): string {
  const { name, attribution, edition } = translation.source;
  const who = attribution ?? name;
  return edition === undefined ? `Translation: ${who}` : `Translation: ${edition} — ${who}`;
}

/**
 * The message, assembled from the verse and nothing else.
 *
 * Exported separately from the share call so the wording can be asserted without a native module:
 * what matters about this function is what it contains and what it refuses to contain, and both are
 * properties of a string.
 */
export function composeVerseShare({ surahName, text, translation }: VerseShareInput): string {
  const reference = `${surahName} ${text.surah}:${text.ayah}`;

  const lines: string[] = [text.arabic];

  if (translation !== null) {
    lines.push('', translation.text);
  }

  lines.push('', reference);

  if (translation !== null) {
    lines.push(translationCreditLine(translation));
  }

  /*
    Deliberately not a `Source: …` line. That exact wording was a badge this module removed from
    three reading surfaces, and `faith-no-fabrication-scan.test.ts` fails any file that rebuilds the
    template — a rule worth keeping intact rather than exempting a file from. Naming where the text
    came from in a sentence discharges the attribution just as well, and reads better in somebody
    else's messaging app than a label would.
  */
  lines.push(`Qur’an text from ${text.source.name}`, APP_CREDIT);

  return lines.join('\n');
}

/** True when the composed message still carries the scripture exactly as the repository gave it. */
export function preservesScripture(message: string, text: AyahText): boolean {
  return message.includes(text.arabic);
}

/** What the platform reported. `failed` covers a share sheet that could not be opened at all. */
export type VerseShareOutcome = 'shared' | 'dismissed' | 'failed';

/**
 * Opens the platform's own share sheet.
 *
 * `Share` is React Native's, not a third-party module and not a NoorLife-drawn sheet: the
 * destinations are the ones the user has installed and the app never learns which was chosen beyond
 * the coarse result below. A rejected call is caught rather than thrown, because a share sheet that
 * will not open must not unmount the reader behind an error boundary.
 */
export async function shareVerse(input: VerseShareInput): Promise<VerseShareOutcome> {
  try {
    const result = await Share.share({ message: composeVerseShare(input) });
    return result.action === Share.sharedAction ? 'shared' : 'dismissed';
  } catch {
    return 'failed';
  }
}
