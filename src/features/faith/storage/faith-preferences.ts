import type {
  AsrJuristicMethod,
  CalculationMethod,
  PrayerKey,
  PrayerNotificationPreference,
} from '../data/prayer-times.repository';
import type { ReciterId, TranslationId } from '../data/quran-content.repository';
import {
  DEFAULT_TASBIH_MATERIAL_ID,
  isTasbihMaterialId,
  type TasbihMaterialId,
} from '../data/tasbih/tasbih-materials';
import { faithStorageKeys, hasString, isRecord, readJson, writeJson } from './faith-storage';

/**
 * The user's Faith preferences.
 *
 * ── Why the translation is no longer a hard-coded id ────────────────────────
 * It used to be `DEFAULT_TRANSLATION_ID = '131'`, chosen because `131` is the one translation
 * `resource_id` the vendor's specification names by example. That reasoning was sound and the result
 * was still wrong: a documented example id is not a promise that the id is *enabled for this
 * project*, and for NoorLife's credentials it is not. A live check returned `200` with **zero rows
 * and no attribution** — an edition that exists in the catalogue but yields nothing.
 *
 * Worse, the failure was silent in the one place it mattered. The preferences screen listed every
 * language in one unfiltered run and highlighted whatever the stored id matched, so a user opening
 * it saw a Bosnian edition selected and no explanation of how it got there.
 *
 * So the default is now **resolved from the live catalogue and validated before it is accepted**,
 * never guessed. See `translation-default.ts`. Until that resolution has happened, the stored
 * translation is `null`, which is the honest representation of "this app has not yet been told which
 * translation it can actually use" — and every reader of it has to say so rather than silently
 * requesting an edition that returns nothing.
 */

/**
 * The chosen translation, stored whole rather than as a bare id.
 *
 * ── Why the metadata travels with the id ────────────────────────────────────
 * The settings row has to read "English • M.A.S. Abdel Haleem" the instant it renders, and the
 * reader has to credit a translator before any catalogue request could return. Storing only the id
 * meant every one of those surfaces did a catalogue lookup to render a string that cannot change,
 * and showed a bare number whenever the lookup had not landed — which is exactly what
 * `content-info-screen.tsx` still falls back to ("Edition 131 — details could not be loaded").
 */
export type TranslationChoice = {
  readonly id: TranslationId;
  /** The catalogue's own `language_name`, e.g. `english`. Lower-cased by the vendor. */
  readonly language: string;
  /** The edition's title, e.g. "The Clear Quran". */
  readonly name: string;
  /** Who translated it. Required — an edition NoorLife cannot attribute is never offered. */
  readonly translator: string;
};

export type FaithPreferences = {
  /**
   * The chosen translation, or `null` when none has been resolved yet.
   *
   * `null` is a real state, not an absence of one: on a fresh install, and after a stored edition is
   * found to be unavailable, NoorLife genuinely does not know which translation it may use until the
   * catalogue answers. Screens render Arabic with an honest "choosing a translation" note rather
   * than requesting an edition that will return nothing.
   */
  readonly translation: TranslationChoice | null;
  /**
   * True when the user picked this translation themselves.
   *
   * ── The one flag that makes migration safe ──────────────────────────────────
   * The brief asks for two things that look contradictory: migrate an accidental Bosnian default to
   * English, *and* preserve a deliberate non-English selection. Nothing about the stored id can tell
   * those apart — both are "a valid non-English edition" — so the distinction has to be recorded at
   * the moment of choosing. A value NoorLife picked is replaceable; a value the user picked is not.
   */
  readonly translationChosenByUser: boolean;
  /**
   * Whether `DEFAULT_TRANSLATION_CHOICE` has already been applied to this install.
   *
   * ── The one fact that makes a seeded default and a live resolver coexist ────
   * Without it, `translation: null` is ambiguous in the one place ambiguity is fatal. It means
   * "nothing has ever been chosen" on a fresh install, and it means "the stored edition turned out
   * to be unavailable and was deliberately cleared" after `resetToDefault`. Seeding on the first
   * reading is right; seeding on the second would hand the user straight back the edition that had
   * just failed them, forever.
   *
   * So the seed is applied exactly once per install and this records that it happened. After that,
   * `null` means what the recovery path needs it to mean, and the live resolver runs.
   */
  readonly translationDefaultSeeded: boolean;
  readonly reciterId: ReciterId;
  /**
   * True when the user picked this reciter themselves.
   *
   * ── The same flag as `translationChosenByUser`, for the same reason ─────────
   * NoorLife's own default reciter used to be `1`, AbdulBaset AbdulSamad — the one recitation
   * `resource_id` the vendor's specification names by example. The verified default is now `3`,
   * Abdur-Rahman as-Sudais, confirmed against `list_recitation_resources` on NoorLife's credentials.
   *
   * Nothing about a stored `1` distinguishes "the app chose this" from "this user prefers
   * AbdulBaset", and both are entirely reasonable readings. Only the moment of choosing can record
   * the difference, so it is recorded there. A value NoorLife picked is correctable; a value the
   * user picked is theirs.
   */
  readonly reciterChosenByUser: boolean;
  readonly calculationMethod: CalculationMethod;
  readonly asrMethod: AsrJuristicMethod;
  /**
   * The master switch for prayer alerts.
   *
   * ── Why a master switch as well as five per-prayer ones ─────────────────────
   * Because "off" and "off for every prayer" are different intentions and only one of them survives
   * a change of mind. A user who turns all five off and later turns Fajr back on has to be asked for
   * notification permission again if the master was never on; a user who switches the master off is
   * pausing a configuration they want back. Keeping them separate also lets the preference be
   * preserved when the OS permission is denied, which the brief requires: the switch stays where the
   * user left it and the screen says delivery is disabled.
   */
  readonly prayerNotificationsEnabled: boolean;
  readonly prayerNotifications: readonly PrayerNotificationPreference[];
  /** Show transliteration beneath Arabic in the Duas screen. */
  readonly showTransliteration: boolean;
  /**
   * Haptic feedback on the tasbih counter.
   *
   * Defaults to on: a counter is the one surface in this module where haptics are unambiguously
   * useful, because they let somebody count with their eyes closed. The switch lives on the Tasbih
   * screen itself rather than in preferences, so it can be turned off in the moment it becomes
   * unwelcome.
   */
  readonly hapticsEnabled: boolean;
  /**
   * Which bead material the Tasbih strand is drawn in, as a **stable id**.
   *
   * ── Why this is safe to persist before the artwork exists ─────────────────
   * It stores a word, never a filename or an asset path, so it survives a re-export and leaks no
   * build detail into user data. It is read back through `isTasbihMaterialId`, so a value written by
   * a future build — or a corrupted one — falls back to the default rather than being handed to a
   * lookup with no entry for it.
   *
   * A stored id is a *preference*, not a claim that the material can be drawn. Availability is
   * `tasbih-materials.ts`'s business, and the screen consults it separately.
   */
  readonly tasbihMaterialId: TasbihMaterialId;
  /** Last chosen location label, so a manual city survives a restart. */
  readonly locationLabel: string | null;
};

const DEFAULT_NOTIFICATIONS: readonly PrayerNotificationPreference[] = (
  ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'] as const satisfies readonly PrayerKey[]
).map((prayer) => ({ prayer, enabled: false, minutesBefore: 10 }));

/**
 * Notifications default to **off**.
 *
 * Opting a user into five daily notifications without asking is the kind of default that
 * gets an app uninstalled, and the Faith permission rationale in the module registry
 * promises reminders happen "at the time you choose" — which presupposes choosing.
 */

/**
 * The default reciter — Quran Foundation recitation `3`, Abdur-Rahman as-Sudais.
 *
 * ── Why this one is a constant when the translation is not ──────────────────
 * Because it was verified against the live catalogue rather than read out of a specification's
 * example. `3` is the resource id the vendor's own `list_recitation_resources` returns for
 * Abdur-Rahman as-Sudais on NoorLife's credentials, which is the check the translation default
 * failed. A constant that has been confirmed against the thing it names is not a guess.
 */
export const DEFAULT_RECITER_ID: ReciterId = '3';

/** The reciter's canonical name, for the settings row before the catalogue resolves. */
export const DEFAULT_RECITER_NAME = 'Abdur-Rahman as-Sudais';

/**
 * The language a resolved default must be in, matched against the catalogue's `language_name`.
 *
 * Lower-cased and compared case-insensitively because the vendor sends `english`, not `English`.
 */
export const DEFAULT_TRANSLATION_LANGUAGE = 'english';

/**
 * The translator preferred for the default when the catalogue offers them.
 *
 * A *preference*, not a requirement: if no edition by this translator resolves and validates, the
 * first valid English edition is used instead. Matching is on a normalised substring because the
 * catalogue's `author_name` spelling is the vendor's and has varied ("M.A.S. Abdel Haleem",
 * "Abdul Haleem"), and pinning an exact string would silently fall through to the fallback.
 */
export const PREFERRED_DEFAULT_TRANSLATORS: readonly string[] = ['abdel haleem', 'abdul haleem'];

/**
 * NoorLife's default translation — Quran Foundation resource `85`.
 *
 * ── Why this is a constant now, when it deliberately was not before ─────────
 * The previous constant, `131`, was taken from the vendor's *specification* and never checked: on
 * NoorLife's credentials it answers `200` with zero rows and no attribution. The correction was to
 * stop guessing, and `translation-default.ts` was written to resolve a default from the live
 * catalogue and prove it renders before accepting it. That resolver worked, and its answer is this
 * edition — reached, on every install, by one `list_translation_resources` read followed by up to
 * five sequential single-verse probe requests, each a full authenticated round trip, all of them on
 * the path that gates the reader's first paint.
 *
 * So the resolver is kept and the *rediscovery* is not. `85` is not a guess in the way `131` was: it
 * is the resolver's own validated output, recorded rather than recomputed. It has been through the
 * exact three checks `validateTranslation` applies — a real page, a real row, and a real credit.
 *
 * ── What still re-resolves ──────────────────────────────────────────────────
 * Everything that made the resolver worth having. `translationChosenByUser` stays `false` for this
 * value, so it is replaceable; if the edition is ever withdrawn the reader reports
 * `edition-unavailable`, `resetToDefault` clears it, and the live catalogue is consulted again. The
 * saving is only that a working default is not re-derived from first principles every install.
 *
 * The `name`/`translator` split is the catalogue's own and looks redundant but is not: the vendor
 * files this edition under the title "M.A.S. Abdel Haleem" with `author_name` "Abdul Haleem", and
 * both spellings are already in `PREFERRED_DEFAULT_TRANSLATORS` for that reason.
 */
export const DEFAULT_TRANSLATION_CHOICE: TranslationChoice = {
  id: '85',
  language: 'english',
  name: 'M.A.S. Abdel Haleem',
  translator: 'Abdul Haleem',
};

/**
 * Translation identifiers that must never survive a read.
 *
 * ── Why `131` is in this list ───────────────────────────────────────────────
 * The rest are ids written by builds that predate approved Quran Foundation access —
 * `mock.en.clear` and friends are not editions the live source has ever heard of, so sending one
 * earns a `404` and the reader shows "not found" for a user who chose nothing wrong.
 *
 * `131` is different and is the reason this list is now consulted for more than fixtures. It is a
 * real catalogue entry, so it does not `404`; it simply returns **no rows and no attribution** for
 * this project, which the reader can only render as "this surah has no translation". A stored id
 * that produces a silently empty reading experience is worse than one that fails loudly, and it is
 * not a value any user deliberately chose — it was NoorLife's own default. Correcting it is honest.
 *
 * A user who has *deliberately* selected an edition is protected by `translationChosenByUser`, and
 * that protection is checked before this list is.
 */
export const RETIRED_TRANSLATION_IDS: ReadonlySet<string> = new Set([
  'mock.en.clear',
  'mock.en.plain',
  'mock.ar.reciter',
  /** Returns `200` with zero rows and no attribution on NoorLife's credentials. */
  '131',
]);

/** Reciter identifiers from the fixture-only builds. */
export const RETIRED_RECITER_IDS: ReadonlySet<string> = new Set([
  'mock.en.clear',
  'mock.en.plain',
  'mock.ar.reciter',
]);

/**
 * Reciters NoorLife once defaulted to, and no longer does.
 *
 * ── Why `1` is corrected rather than left alone ─────────────────────────────
 * It is a perfectly real, perfectly working recitation — this is not the `131` situation, where the
 * stored id returned nothing. It is simply not the default NoorLife chose after checking the live
 * catalogue, and an install that predates that decision has no way of knowing.
 *
 * The correction is therefore narrow and reversible: it applies **only** when
 * `reciterChosenByUser` is false, so a user who deliberately selected AbdulBaset keeps him, and
 * anyone who dislikes Sudais can select otherwise in one tap on the reciter screen.
 */
export const SUPERSEDED_DEFAULT_RECITER_IDS: ReadonlySet<string> = new Set(['1']);

export const defaultFaithPreferences: FaithPreferences = {
  /**
   * The validated default, present from the first render.
   *
   * This used to be `null`, which was honest about what the app knew and expensive about how it
   * found out: every install resolved the same answer from the live catalogue across up to six
   * sequential authenticated round trips, with the reader held in `resolving` for the duration.
   */
  translation: DEFAULT_TRANSLATION_CHOICE,
  translationChosenByUser: false,
  translationDefaultSeeded: true,
  reciterId: DEFAULT_RECITER_ID,
  reciterChosenByUser: false,
  calculationMethod: 'muslim-world-league',
  asrMethod: 'standard',
  prayerNotificationsEnabled: false,
  prayerNotifications: DEFAULT_NOTIFICATIONS,
  showTransliteration: true,
  hapticsEnabled: true,
  tasbihMaterialId: DEFAULT_TASBIH_MATERIAL_ID,
  locationLabel: null,
};

function isTranslationChoice(value: unknown): value is TranslationChoice {
  return (
    isRecord(value) &&
    hasString(value, 'id') &&
    hasString(value, 'language') &&
    hasString(value, 'name') &&
    hasString(value, 'translator')
  );
}

function isPreferences(value: unknown): value is Partial<FaithPreferences> {
  return isRecord(value);
}

/**
 * The stored blob as it was written by a build that predates `TranslationChoice`.
 *
 * Read explicitly rather than by casting, because the whole point of the migration is that these
 * fields are *not* trustworthy — `translationId` is exactly the value that turned out to be wrong.
 */
type LegacyShape = {
  readonly translationId?: unknown;
  readonly reciterId?: unknown;
};

/**
 * Turns whatever is in storage into the current shape.
 *
 * Exported so the migration is testable on its own, without AsyncStorage in the way. Every branch
 * below answers one of the brief's migration cases, and the order matters: the user's own choice is
 * considered before any correction NoorLife would otherwise apply.
 */
export function migratePreferences(stored: unknown): FaithPreferences {
  const record = isPreferences(stored) ? stored : {};
  const legacy = record as LegacyShape;
  const merged = { ...defaultFaithPreferences, ...record } as FaithPreferences;

  /**
   * The reciter, correcting NoorLife's own superseded default but never the user's choice.
   *
   * Order matters: the user's own decision is consulted before any correction NoorLife would
   * otherwise apply, exactly as it is for the translation above.
   */
  const reciterChosenByUser = record.reciterChosenByUser === true;
  const storedReciter = typeof legacy.reciterId === 'string' ? legacy.reciterId : null;
  const reciterId =
    storedReciter === null || RETIRED_RECITER_IDS.has(storedReciter)
      ? DEFAULT_RECITER_ID
      : reciterChosenByUser || !SUPERSEDED_DEFAULT_RECITER_IDS.has(storedReciter)
        ? storedReciter
        : DEFAULT_RECITER_ID;

  /**
   * Whether this install has already been offered the seeded default.
   *
   * Read from the stored blob rather than from `merged`, because `merged` has the current defaults
   * spread underneath it and would report `true` for a blob written before the field existed.
   */
  const seeded = record.translationDefaultSeeded === true;

  /*
    Validated rather than trusted, for the same reason as the reciter above: `merged` spreads the
    stored blob over the defaults, so anything at this key arrives intact.
  */
  const tasbihMaterialId: TasbihMaterialId = isTasbihMaterialId(record.tasbihMaterialId)
    ? record.tasbihMaterialId
    : DEFAULT_TASBIH_MATERIAL_ID;

  /**
   * A blob written by the current build, carrying a whole choice.
   *
   * Kept as-is when the user chose it. When NoorLife chose it, a retired id is dropped so a fresh
   * default is applied — which is what migrates the accidental Bosnian default, and what corrects
   * `131`.
   */
  if (isTranslationChoice(record.translation)) {
    const chosenByUser = record.translationChosenByUser === true;
    const retired = RETIRED_TRANSLATION_IDS.has(record.translation.id);
    if (chosenByUser || !retired) {
      return {
        ...merged,
        translation: record.translation,
        translationChosenByUser: chosenByUser,
        translationDefaultSeeded: true,
        reciterId,
        reciterChosenByUser,
      };
    }
    /**
     * A retired id NoorLife itself chose. Replaced with the validated default rather than cleared:
     * clearing it was correct when there was no known-good edition to name, and there is now.
     */
    return {
      ...merged,
      translation: DEFAULT_TRANSLATION_CHOICE,
      translationChosenByUser: false,
      translationDefaultSeeded: true,
      reciterId,
      reciterChosenByUser,
    };
  }

  /**
   * No usable choice in the blob — `null`, absent, or a legacy bare `translationId`.
   *
   * ── The two cases behind one value, and why `seeded` separates them ─────────
   * An install that has never been seeded gets the validated default. An install that *has* been
   * seeded and is nonetheless holding `null` got there by `resetToDefault`, which is the recovery
   * path for an edition the source stopped serving — and handing that install the same constant back
   * would restore the broken edition on the next read and make the recovery unreachable. It keeps
   * `null`, and `useTranslationPreference` consults the live catalogue.
   *
   * A legacy bare `translationId` is never honoured in either case. There is no record of whether
   * the user chose it, the screen that wrote it listed every language unfiltered, and the likeliest
   * story for any stored value is NoorLife's own default or a mis-tap in an unnavigable list.
   */
  return {
    ...merged,
    translation: seeded ? null : DEFAULT_TRANSLATION_CHOICE,
    translationChosenByUser: false,
    translationDefaultSeeded: true,
    reciterId,
    reciterChosenByUser,
    tasbihMaterialId,
  };
}

export async function readFaithPreferences(): Promise<FaithPreferences> {
  /**
   * Read as `unknown` and validated by the migration rather than by a type guard here.
   *
   * A guard that rejected an old blob would fall back to the defaults and throw away the user's
   * calculation method, their notification choices and their location along with the one field that
   * needed correcting. `migratePreferences` is total over anything JSON can hold, so it keeps what is
   * still good and repairs only what is not.
   */
  const stored = await readJson<unknown>(
    faithStorageKeys.preferences,
    null,
    (value): value is unknown => isRecord(value),
  );
  return migratePreferences(stored);
}

export async function writeFaithPreferences(
  update: Partial<FaithPreferences>,
): Promise<FaithPreferences> {
  const current = await readFaithPreferences();
  const next: FaithPreferences = { ...current, ...update };
  await writeJson(faithStorageKeys.preferences, next);
  return next;
}
