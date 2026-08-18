/**
 * What counts as a usable display name.
 *
 * ── Why this is a pure function ─────────────────────────────────────────────
 * Three of the phase's requirements are claims about *values*, not about a rendered form: an
 * international name is accepted, a whitespace-only name is rejected, and an over-long name is
 * rejected. Proving those against a function is exact; proving them by typing into a component and
 * looking for red text is a proxy that passes for the wrong reasons.
 *
 * ── Why there is no character allow-list ────────────────────────────────────
 * A Latin-only pattern would reject أحمد, Айша, 王, and every hyphenated, apostrophised or
 * accented European name — a category of user, excluded by a validation rule that protects nothing.
 * Names are also not addresses or identifiers: there is no format to conform to. So the only
 * rejections here are the ones that are genuinely about the value being unusable — it is empty, it
 * is longer than a name, or it carries characters that cannot be displayed at all.
 */

/**
 * The longest name accepted, in characters, after trimming.
 *
 * 80 is chosen against the longest real names rather than against a database column: the longest
 * officially recorded personal names run to the mid-fifties, and a full Arabic name carrying three
 * generations of patronymic plus a nisba sits comfortably inside 80. It is also short enough that
 * an accidental paste of a paragraph is caught rather than stored.
 */
export const PROFILE_NAME_MAX_LENGTH = 80;

/** Why a name was refused. Rendered through locked copy — never a raw message from here. */
export type ProfileNameProblem = 'empty' | 'too-long' | 'control-characters';

export type ProfileNameValidation =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly problem: ProfileNameProblem };

/**
 * C0 controls, DEL and the C1 range.
 *
 * A tab or a line break inside a name is a paste artefact rather than a name, and it would render
 * as a gap the user can neither see nor delete. Written as escapes so the pattern itself stays
 * readable and this file contains no unprintable bytes.
 */
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F-\u009F]/;

/** Leading and trailing whitespace is never part of a name, so it is removed before anything else. */
export function normalizeFullName(raw: string): string {
  return raw.trim();
}

export function validateFullName(raw: string): ProfileNameValidation {
  const value = normalizeFullName(raw);

  if (value.length === 0) {
    return { ok: false, problem: 'empty' };
  }
  // Checked on the trimmed value: trailing spaces are not the user's mistake to be punished for.
  if (value.length > PROFILE_NAME_MAX_LENGTH) {
    return { ok: false, problem: 'too-long' };
  }
  if (CONTROL_CHARACTERS.test(value)) {
    return { ok: false, problem: 'control-characters' };
  }

  return { ok: true, value };
}

/**
 * Whether the entered name differs from the stored one.
 *
 * Compared after trimming, so adding a trailing space is not an "unsaved change" — Save stays
 * disabled and Back does not stop to ask about an edit the user did not make.
 */
export function hasNameChanged(entered: string, stored: string | null): boolean {
  return normalizeFullName(entered) !== normalizeFullName(stored ?? '');
}
