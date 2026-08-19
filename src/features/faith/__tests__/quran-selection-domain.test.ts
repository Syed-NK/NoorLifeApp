import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  checkSelectionRange,
  isSelectionCounterId,
  MAX_SELECTION_AYAT,
  MAX_SELECTION_LABEL_LENGTH,
  normaliseSelectionLabel,
  orderRange,
  sanitiseSelection,
  SELECTION_FIELDS,
  selectionFaultMessage,
  selectionIdFor,
  selectionLength,
  selectionReferenceLabel,
  selectionVerseKeys,
  type SelectionRangeFault,
} from '../data/quran-selection/quran-selection';
import {
  favouriteSelections,
  labelQuranSelection,
  markQuranSelectionUsed,
  readQuranSelections,
  recentSelections,
  removeQuranSelection,
  saveQuranSelection,
  toggleQuranSelectionFavourite,
} from '../storage/faith-quran-selections';
import { resetFaithScopeForTest, setActiveFaithScope } from '../storage/faith-user-scope';
import { faithAddress, TEST_FAITH_USER_ID } from '@/test-support/faith-storage-address';

/**
 * **A Quran selection is a reference. This file is the proof.**
 *
 * ── The claim under test, stated precisely ─────────────────────────────────
 * No character of Arabic, translation or transliteration is written into user storage by this
 * feature — not as a field, not as a cached preview, not "just the first verse for the list row".
 * The claim is not "we were careful"; it is that the code path does not exist, and the way to
 * demonstrate that is to hand the storage layer scripture and read the store back as raw text.
 *
 * `SCRIPTURE_PROBE` is not Qur'anic. It is a distinctive Arabic-script string chosen precisely
 * *because* it is not scripture: putting a real ayah in a test fixture is how unverified religious
 * text survives a deletion, and a probe only has to be findable to do its job.
 */

/** Arabic-script text that is not scripture, used to prove text does not survive a write. */
const SCRIPTURE_PROBE = 'صصص-probe-صصص';

beforeEach(async () => {
  await AsyncStorage.clear();
  setActiveFaithScope(TEST_FAITH_USER_ID);
});

afterEach(() => {
  setActiveFaithScope(TEST_FAITH_USER_ID);
});

describe('the reference itself', () => {
  it('derives one stable id per reference, so saving a verse twice cannot duplicate it', () => {
    expect(selectionIdFor({ surah: 2, startAyah: 255, endAyah: 255 })).toBe('q.2.255.255');
    expect(selectionIdFor({ surah: 2, startAyah: 255, endAyah: 255 })).toBe(
      selectionIdFor({ surah: 2, startAyah: 255, endAyah: 255 }),
    );
    expect(selectionIdFor({ surah: 59, startAyah: 22, endAyah: 24 })).toBe('q.59.22.24');
  });

  it('gives distinct references distinct ids, including ranges that share an endpoint', () => {
    const ids = new Set([
      selectionIdFor({ surah: 2, startAyah: 1, endAyah: 5 }),
      selectionIdFor({ surah: 2, startAyah: 1, endAyah: 1 }),
      selectionIdFor({ surah: 2, startAyah: 5, endAyah: 5 }),
      selectionIdFor({ surah: 21, startAyah: 1, endAyah: 5 }),
    ]);
    expect(ids.size).toBe(4);
  });

  it('marks a selection counter apart from a personal one', () => {
    expect(isSelectionCounterId('q.2.255.255')).toBe(true);
    expect(isSelectionCounterId('user-m9x2')).toBe(false);
    expect(isSelectionCounterId('default')).toBe(false);
  });

  it('labels a single verse and a range differently', () => {
    expect(selectionReferenceLabel({ surah: 2, startAyah: 255, endAyah: 255 })).toBe('2:255');
    expect(selectionReferenceLabel({ surah: 59, startAyah: 22, endAyah: 24 })).toBe('59:22-24');
  });

  it('enumerates the verse keys in reference order', () => {
    expect(selectionVerseKeys({ surah: 59, startAyah: 22, endAyah: 24 })).toEqual([
      '59:22',
      '59:23',
      '59:24',
    ]);
    expect(selectionLength({ surah: 59, startAyah: 22, endAyah: 24 })).toBe(3);
  });

  it('puts a backwards range in order rather than refusing it', () => {
    expect(orderRange(24, 22)).toEqual({ start: 22, end: 24 });
    expect(orderRange(22, 24)).toEqual({ start: 22, end: 24 });
  });
});

describe('what may be selected', () => {
  it('accepts a single verse and a contiguous range within the surah', () => {
    expect(checkSelectionRange({ surah: 2, startAyah: 255, endAyah: 255 }, 286).ok).toBe(true);
    expect(checkSelectionRange({ surah: 59, startAyah: 22, endAyah: 24 }, 24).ok).toBe(true);
  });

  it.each([
    ['surah 0', { surah: 0, startAyah: 1, endAyah: 1 }, 'surah-out-of-range'],
    ['surah 115', { surah: 115, startAyah: 1, endAyah: 1 }, 'surah-out-of-range'],
    ['ayah 0', { surah: 2, startAyah: 0, endAyah: 1 }, 'ayah-out-of-range'],
    ['a reversed range', { surah: 2, startAyah: 5, endAyah: 2 }, 'end-before-start'],
    [
      'a range past the length cap',
      { surah: 2, startAyah: 1, endAyah: MAX_SELECTION_AYAT + 1 },
      'too-long',
    ],
    ['a verse past the surah', { surah: 114, startAyah: 1, endAyah: 9 }, 'ayah-beyond-surah'],
  ] as const)('refuses %s', (_name, ref, fault) => {
    const result = checkSelectionRange(ref, ref.surah === 114 ? 6 : 286);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fault).toBe(fault);
  });

  it('checks everything it still can when the surah length is unknown', () => {
    /*
      A device with no published generation does not know how long a surah is. The bound on range
      length is still enforced — that one is NoorLife's own product limit — and the verse that may
      not exist is caught by the resolver rather than guessed at here.
    */
    expect(checkSelectionRange({ surah: 2, startAyah: 1, endAyah: 40 }, null).ok).toBe(false);
    expect(checkSelectionRange({ surah: 2, startAyah: 900, endAyah: 900 }, null).ok).toBe(true);
  });

  it('has a message for every fault, so no refusal is silent', () => {
    const faults: readonly SelectionRangeFault[] = [
      'surah-out-of-range',
      'ayah-out-of-range',
      'end-before-start',
      'too-long',
      'ayah-beyond-surah',
    ];
    for (const fault of faults) {
      expect(selectionFaultMessage(fault).length).toBeGreaterThan(0);
    }
  });
});

describe('the sanitiser, which is the guarantee', () => {
  it('keeps exactly the eight allowed fields and nothing else', () => {
    const clean = sanitiseSelection({
      id: 'q.2.255.255',
      surah: 2,
      startAyah: 255,
      endAyah: 255,
      label: 'For the evening',
      favourite: true,
      createdAt: 1000,
      lastUsedAt: 2000,
    });
    expect(clean).not.toBeNull();
    expect(Object.keys(clean ?? {}).sort()).toEqual([...SELECTION_FIELDS].sort());
  });

  it('drops Arabic, translation and transliteration handed to it', () => {
    const clean = sanitiseSelection({
      surah: 2,
      startAyah: 255,
      endAyah: 255,
      arabic: SCRIPTURE_PROBE,
      translation: 'a rendering of the meaning',
      transliteration: 'a transliteration',
      translator: 'somebody',
      text: SCRIPTURE_PROBE,
      label: null,
      favourite: false,
      createdAt: 1,
      lastUsedAt: null,
    });
    expect(clean).not.toBeNull();
    const serialised = JSON.stringify(clean);
    expect(serialised).not.toContain(SCRIPTURE_PROBE);
    expect(serialised).not.toContain('rendering of the meaning');
    expect(serialised).not.toContain('transliteration');
    expect(serialised).not.toContain('somebody');
  });

  it('recomputes the id from the reference rather than trusting a stored one', () => {
    const clean = sanitiseSelection({
      id: 'q.9.9.9',
      surah: 2,
      startAyah: 255,
      endAyah: 255,
      favourite: false,
      createdAt: 1,
      lastUsedAt: null,
      label: null,
    });
    expect(clean?.id).toBe('q.2.255.255');
  });

  it('refuses a record whose range is impossible rather than repairing it', () => {
    expect(sanitiseSelection({ surah: 0, startAyah: 1, endAyah: 1 })).toBeNull();
    expect(sanitiseSelection({ surah: 2, startAyah: 1, endAyah: 400 })).toBeNull();
    expect(sanitiseSelection('not an object')).toBeNull();
    expect(sanitiseSelection(null)).toBeNull();
  });

  it('bounds and trims a user note, and makes blank mean absent', () => {
    expect(normaliseSelectionLabel('   ')).toBeNull();
    expect(normaliseSelectionLabel(null)).toBeNull();
    expect(normaliseSelectionLabel('  keep me  ')).toBe('keep me');
    expect(normaliseSelectionLabel('x'.repeat(MAX_SELECTION_LABEL_LENGTH + 20))).toHaveLength(
      MAX_SELECTION_LABEL_LENGTH,
    );
  });
});

describe('what actually reaches the device', () => {
  it('stores a reference and never the scripture it names', async () => {
    const outcome = await saveQuranSelection({ surah: 2, startAyah: 255, endAyah: 255 }, null);
    expect(outcome.kind).toBe('saved');

    const raw = (await AsyncStorage.getItem(faithAddress('quranSelections'))) ?? '';
    // The reference is there…
    expect(raw).toContain('"surah":2');
    expect(raw).toContain('"startAyah":255');
    // …and nothing that could be scripture is.
    expect(raw).not.toMatch(/[؀-ۿ]/);
    expect(raw).not.toContain('arabic');
    expect(raw).not.toContain('translation');
  });

  it('cannot be made to store text by handing it a resolved selection', async () => {
    /*
      The realistic accident: a caller passes the *resolved* object — reference plus verses plus
      translator — into the save path. The extra fields are not rejected with a warning nobody reads;
      they are simply not among the fields that get copied.
    */
    const contaminated = {
      surah: 112,
      startAyah: 1,
      endAyah: 4,
      arabic: SCRIPTURE_PROBE,
      verses: [{ verseKey: '112:1', arabic: SCRIPTURE_PROBE, translation: 'meaning' }],
      translator: 'a translator',
    } as unknown as { surah: number; startAyah: number; endAyah: number };

    await saveQuranSelection(contaminated, null);
    const raw = (await AsyncStorage.getItem(faithAddress('quranSelections'))) ?? '';
    expect(raw).not.toContain(SCRIPTURE_PROBE);
    expect(raw).not.toContain('a translator');
    expect(raw).toContain('"surah":112');
  });

  it('saves once per reference and keeps the favourite through a re-save', async () => {
    const ref = { surah: 2, startAyah: 255, endAyah: 255 };
    const first = await saveQuranSelection(ref, 'Evening');
    expect(first.kind === 'saved' && first.created).toBe(true);

    await toggleQuranSelectionFavourite('q.2.255.255');
    const second = await saveQuranSelection(ref, null);
    expect(second.kind === 'saved' && second.created).toBe(false);

    const stored = await readQuranSelections();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.favourite).toBe(true);
    expect(stored[0]?.label).toBe('Evening');
  });

  it('records use, which is what recently-used means, and rendering a list does not', async () => {
    await saveQuranSelection({ surah: 1, startAyah: 1, endAyah: 7 }, null);
    await saveQuranSelection({ surah: 2, startAyah: 255, endAyah: 255 }, null);

    expect(recentSelections(await readQuranSelections())).toHaveLength(0);

    await markQuranSelectionUsed('q.2.255.255');
    const recent = recentSelections(await readQuranSelections());
    expect(recent).toHaveLength(1);
    expect(recent[0]?.id).toBe('q.2.255.255');
  });

  it('favourites, unfavourites, relabels and removes', async () => {
    await saveQuranSelection({ surah: 1, startAyah: 1, endAyah: 7 }, null);
    await toggleQuranSelectionFavourite('q.1.1.7');
    expect(favouriteSelections(await readQuranSelections())).toHaveLength(1);

    await toggleQuranSelectionFavourite('q.1.1.7');
    expect(favouriteSelections(await readQuranSelections())).toHaveLength(0);

    await labelQuranSelection('q.1.1.7', '  a note  ');
    expect((await readQuranSelections())[0]?.label).toBe('a note');

    await removeQuranSelection('q.1.1.7');
    expect(await readQuranSelections()).toHaveLength(0);
  });

  it('survives a corrupt blob by returning nothing rather than failing to render', async () => {
    await AsyncStorage.setItem(faithAddress('quranSelections'), 'not json at all');
    expect(await readQuranSelections()).toEqual([]);
  });

  it('drops an unreadable record while keeping the readable ones beside it', async () => {
    await AsyncStorage.setItem(
      faithAddress('quranSelections'),
      JSON.stringify({
        version: 1,
        selections: [
          { surah: 2, startAyah: 255, endAyah: 255, favourite: false, createdAt: 1 },
          { surah: 900, startAyah: 1, endAyah: 1 },
          'nonsense',
        ],
      }),
    );
    const stored = await readQuranSelections();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.id).toBe('q.2.255.255');
  });
});

describe('whose selections these are', () => {
  const USER_A = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
  const USER_B = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';

  it('does not let a second account on the same device read the first account’s list', async () => {
    setActiveFaithScope(USER_A);
    await saveQuranSelection({ surah: 2, startAyah: 255, endAyah: 255 }, 'A private note');
    await toggleQuranSelectionFavourite('q.2.255.255');
    expect(await readQuranSelections()).toHaveLength(1);

    setActiveFaithScope(USER_B);
    expect(await readQuranSelections()).toEqual([]);

    // …and A's list is still A's when A comes back.
    setActiveFaithScope(USER_A);
    const back = await readQuranSelections();
    expect(back).toHaveLength(1);
    expect(back[0]?.label).toBe('A private note');
    expect(back[0]?.favourite).toBe(true);
  });

  it('reads nothing and writes nothing while signed out', async () => {
    setActiveFaithScope(USER_A);
    await saveQuranSelection({ surah: 1, startAyah: 1, endAyah: 7 }, null);

    resetFaithScopeForTest();
    expect(await readQuranSelections()).toEqual([]);

    const outcome = await saveQuranSelection({ surah: 36, startAyah: 1, endAyah: 1 }, null);
    /*
      Reported as a failure rather than silently dropped. A signed-out save has no owner to attribute
      it to, and telling the screen it worked would show a saved selection that vanishes.
    */
    expect(outcome.kind).toBe('failed');

    setActiveFaithScope(USER_A);
    const stored = await readQuranSelections();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.id).toBe('q.1.1.7');
  });
});
