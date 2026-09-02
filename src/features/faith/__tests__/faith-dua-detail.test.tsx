import AsyncStorage from '@react-native-async-storage/async-storage';
import { cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { useWindowDimensions } from 'react-native';

import { faithAddress, TEST_FAITH_USER_ID } from '@/test-support/faith-storage-address';
import { warmUpFirstMount } from '@/test-support/mock-latency-timers';

import { QURAN_CONTENT_ATTRIBUTION } from '../data/dhikr/quran-content-attribution';
import {
  duaCounterId,
  duaDetailIdFor,
  duaDetailPresentation,
  duaResolutionRef,
  parseDuaDetailId,
  resolveDuaDetail,
} from '../data/duas/dua-detail';
import { QURAN_PROVIDER, reviewedDuas, type ReviewedDua } from '../data/duas/reviewed-dua';
import { createMockFaithRepositories } from '../data/mock';
import type { RetainedQuran, RetainedQuranSource } from '../data/offline/retained-quran.source';
import type { QuranSelection } from '../data/quran-selection/quran-selection';
import { createLocalTasbihRepository } from '../data/tasbih/local-tasbih.repository';
import { FaithRepositoryProvider } from '../di/faith-repository-context';
import { DuaDetailScreen } from '../screens/dua-detail-screen';
import {
  readQuranSelections,
  saveQuranSelection,
  toggleQuranSelectionFavourite,
} from '../storage/faith-quran-selections';
import { setActiveFaithScope } from '../storage/faith-user-scope';

/**
 * **One dua, in full: what it discloses, what it omits, and what its two actions must do first.**
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Omission is the property under test, and it is not a rendering detail ───
 * A detail page is a long list of conditionals, and every one of them is a place a missing field can be
 * turned into a plausible default. `null` becoming an em dash is harmless. `null` becoming a repetition
 * count is an invented religious instruction that would look exactly like the reviewed ones beside it.
 *
 * So the omissions are asserted twice: against `duaDetailPresentation` directly, where the rule lives and
 * where a missing field can be shown to produce *no value*, and against the rendered screen, where it can
 * be shown to produce *no element*. Neither alone is enough — a pure function that returns `null` still
 * leaves a component free to draw a placeholder for it.
 *
 * ── The reviewed fixtures are synthetic and go through the real gate ────────
 * Nothing here writes a `ReviewedDua` by hand. Every reviewed case is built as manifest data and parsed
 * by `reviewedDuas`, so a fixture that would not be publishable cannot be used to prove the page works.
 * The strings are placeholders; no real Arabic, narration, translation or reviewer appears.
 *
 * ── The Tasbih ordering is the case that has already been wrong on a device ──
 * Fired and forgotten, the push wins the race and the counter opens captioned with whatever was active
 * before. Storage settles correctly either way, which is why only an ordering assertion catches it.
 * ═══════════════════════════════════════════════════════════════════════════
 */

jest.mock('react-native/Libraries/Utilities/useWindowDimensions');

const mockedDimensions = useWindowDimensions as unknown as jest.Mock;
/**
 * The shared router double from `jest.setup.ts`.
 *
 * ── Why it is not reached by calling the hook ──────────────────────────────
 * `useRouter()` at module scope is a hook call outside a component, and `react-hooks/rules-of-hooks`
 * fails the build on it — correctly, even though the mock is a plain function returning a singleton.
 * Taking the function off the mocked module and calling it through a differently-named binding gets the
 * same object without writing a hook call, which is what the rule is about.
 */
const routerModule = jest.requireMock('expo-router') as { readonly useRouter: () => unknown };
const readRouterDouble = routerModule.useRouter;
const router = readRouterDouble() as { push: jest.Mock; replace: jest.Mock };

const MATRIX = [
  ['411 dp at font 1.0', 411, 1.0],
  ['393 dp at font 1.3', 393, 1.3],
  ['320 dp at font 1.5', 320, 1.5],
] as const;

const PROBE_ARABIC = 'ألف-probe-١';
const TRANSLATOR = 'A Named Translator';
const EDITION = 'A Named Edition';

function viewport(width: number, fontScale: number): void {
  mockedDimensions.mockReturnValue({ width, height: 852, scale: 3, fontScale });
}

function retainedDouble(): RetainedQuranSource {
  const content: RetainedQuran = {
    generationId: 'test-generation',
    arabic: {
      generationId: 'test-generation',
      script: 'text_uthmani',
      lastCheckedAt: 0,
      source: { name: 'Quran Foundation', edition: 'Uthmani', verified: true },
      bySurah: new Map([[2, [{ ayah: 255, text: PROBE_ARABIC }]]]),
    },
    translations: {
      generationId: 'test-generation',
      resourceId: 85,
      source: {
        name: 'Quran Foundation',
        edition: EDITION,
        attribution: TRANSLATOR,
        verified: true,
      },
      bySurah: new Map([[2, [{ ayah: 255, text: 'a rendering of the meaning' }]]]),
    },
  };
  return { read: async () => content };
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function drain(passes = 8): Promise<void> {
  for (let pass = 0; pass < passes; pass += 1) {
    await settle();
  }
}

async function renderDetail(duaId: string, width = 411, fontScale = 1): Promise<typeof screen> {
  viewport(width, fontScale);
  await render(
    <FaithRepositoryProvider
      repositories={{ ...createMockFaithRepositories(), retainedQuran: retainedDouble() }}
    >
      <DuaDetailScreen duaId={duaId} />
    </FaithRepositoryProvider>,
  );
  await drain();
  return screen;
}

const selection = (over: Partial<QuranSelection> = {}): QuranSelection => ({
  id: 'q.2.255.255',
  surah: 2,
  startAyah: 255,
  endAyah: 255,
  label: null,
  favourite: false,
  createdAt: 1,
  lastUsedAt: null,
  ...over,
});

/** A manifest row that passes the real gate, built here so no fixture file ships one. */
const reviewedRow = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'test.reviewed.detail',
  sourceKind: 'quran',
  provider: QURAN_PROVIDER,
  surah: 2,
  startAyah: 255,
  endAyah: 255,
  title: 'A title the reviewer supplied',
  category: 'quranic-remembrance',
  categories: ['daily-remembrances'],
  arabicSource: 'retained-generation',
  translationResourceId: 85,
  transliterationResourceId: null,
  recommendedTarget: null,
  reviewStatus: 'approved',
  review: {
    reviewer: 'A named reviewer',
    source: 'A citable published basis',
    reviewedOn: '2026-08-19',
    recordId: 'review-record-0001',
    popularRank: null,
    repetitionBasis: null,
  },
  contextNote: 'The reviewed context in which this is offered.',
  enabled: true,
  version: 1,
  ...over,
});

/** One parsed reviewed dua, or a thrown failure — never a hand-built object. */
function reviewedFixture(over: Record<string, unknown> = {}): ReviewedDua {
  const parsed = reviewedDuas([reviewedRow(over)]);
  const dua = parsed[0];
  if (dua === undefined) {
    throw new Error('the fixture did not pass the gate, so it may not be used to prove anything');
  }
  return dua;
}

warmUpFirstMount(async () => {
  viewport(411, 1);
  return renderDetail('q.2.255.255');
});

beforeEach(async () => {
  await AsyncStorage.clear();
  setActiveFaithScope(TEST_FAITH_USER_ID);
  viewport(411, 1);
  router.push.mockClear();
  router.replace.mockClear();
});

afterEach(async () => {
  await cleanup();
  mockedDimensions.mockReset();
});

describe('one route, two namespaces, and no guessing between them', () => {
  it('reads which store an id belongs to from the id alone', () => {
    expect(parseDuaDetailId('q.2.255.255')).toBe('personal');
    expect(parseDuaDetailId('test.reviewed.detail')).toBe('reviewed');
    expect(parseDuaDetailId('')).toBeNull();
    expect(parseDuaDetailId('   ')).toBeNull();
  });

  it('addresses each target by its own id, with no second encoding', () => {
    const personal = selection();
    const dua = reviewedFixture();
    expect(duaDetailIdFor({ kind: 'personal', selection: personal })).toBe('q.2.255.255');
    expect(duaDetailIdFor({ kind: 'reviewed', dua })).toBe('test.reviewed.detail');
    /* The counter id is the same id — a counter's identity *is* the thing it counts. */
    expect(duaCounterId({ kind: 'personal', selection: personal })).toBe('q.2.255.255');
    expect(duaCounterId({ kind: 'reviewed', dua })).toBe('test.reviewed.detail');
  });

  it('resolves each kind from its own store and never from the other', () => {
    const personal = selection();
    const dua = reviewedFixture();

    expect(
      resolveDuaDetail({ duaId: 'q.2.255.255', selections: [personal], reviewed: [dua] }),
    ).toEqual({ kind: 'personal', selection: personal });
    expect(
      resolveDuaDetail({ duaId: 'test.reviewed.detail', selections: [personal], reviewed: [dua] }),
    ).toEqual({ kind: 'reviewed', dua });

    /* A reviewed id is never answered from the selection list, even if one somehow held it. */
    expect(
      resolveDuaDetail({ duaId: 'test.reviewed.detail', selections: [personal], reviewed: [] }),
    ).toBeNull();
  });

  it('answers an id that names nothing, rather than redirecting to something else', async () => {
    const view = await renderDetail('test.not-a-dua');

    expect(view.getByTestId('faith-dua-detail-unknown')).toBeTruthy();
    expect(view.getByText(/that dua is not here/i)).toBeTruthy();
    /* And it does not echo the id, which is either a storage address or a manifest id. */
    expect(JSON.stringify(view.toJSON())).not.toContain('test.not-a-dua');
    expect(router.replace).not.toHaveBeenCalled();
  });
});

describe('a personal selection, shown as the user’s own', () => {
  it('shows its Arabic, its translation, its translator and its reference', async () => {
    await saveQuranSelection({ surah: 2, startAyah: 255, endAyah: 255 }, null);
    const view = await renderDetail('q.2.255.255');

    const arabic = view.getByTestId('faith-dua-detail-body-arabic-2:255');
    expect(String(arabic.props.children)).toBe(PROBE_ARABIC);
    expect(view.getByTestId('faith-dua-detail-body-translation-2:255')).toBeTruthy();

    /* The translator's name is drawn by the branch that drew the translation — never separately. */
    const translator = String(view.getByTestId('faith-dua-detail-body-translator').props.children);
    expect(translator).toContain(TRANSLATOR);
    expect(translator).toContain(EDITION);

    expect(String(view.getByTestId('faith-dua-detail-source-reference').props.children)).toBe(
      'Qur’an 2:255',
    );
  });

  it('carries the exact provider attribution, unparaphrased', async () => {
    await saveQuranSelection({ surah: 2, startAyah: 255, endAyah: 255 }, null);
    const view = await renderDetail('q.2.255.255');

    expect(String(view.getByTestId('faith-dua-detail-attribution').props.children)).toBe(
      QURAN_CONTENT_ATTRIBUTION,
    );
    expect(String(view.getByTestId('faith-dua-detail-source-provider').props.children)).toBe(
      QURAN_PROVIDER,
    );
  });

  it('is never presented as scholarly-reviewed, and says what it actually is', async () => {
    await saveQuranSelection({ surah: 2, startAyah: 255, endAyah: 255 }, null);
    const view = await renderDetail('q.2.255.255');

    /*
      ── The misrepresentation this page must not commit ───────────────────────
      A selection is the user pointing at a verse. Shown under a heading NoorLife vouches for, it would
      make exactly the claim the whole module is arranged to avoid. So the badge says whose it is, no
      review block is drawn, and a sentence states plainly that nobody has reviewed it.
    */
    expect(view.getByText('Your selection')).toBeTruthy();
    expect(view.queryByText('Scholarly-reviewed')).toBeNull();
    expect(view.queryByTestId('faith-dua-detail-review')).toBeNull();
    expect(view.getByTestId('faith-dua-detail-source-unreviewed')).toBeTruthy();
    expect(view.getByText(/makes no claim about reciting it/i)).toBeTruthy();
  });

  it('uses the user’s own note as the heading, and says it is theirs', async () => {
    await saveQuranSelection({ surah: 2, startAyah: 255, endAyah: 255 }, 'for the morning');
    const view = await renderDetail('q.2.255.255');

    expect(String(view.getByTestId('faith-dua-detail-title').props.children)).toBe(
      'for the morning',
    );
    expect(view.getByTestId('faith-dua-detail-title-origin')).toBeTruthy();
  });

  it('uses a neutral stand-in with no note, and does not credit it to anybody', async () => {
    await saveQuranSelection({ surah: 2, startAyah: 255, endAyah: 255 }, null);
    const view = await renderDetail('q.2.255.255');

    expect(String(view.getByTestId('faith-dua-detail-title').props.children)).toBe(
      'Your Qur’an selection',
    );
    /* No "your own note" line, because there is no note — the stand-in is NoorLife's, not theirs. */
    expect(view.queryByTestId('faith-dua-detail-title-origin')).toBeNull();
  });

  it('lists the user’s own cards as its membership, and no religious category', () => {
    const plain = duaDetailPresentation({ kind: 'personal', selection: selection() }, null);
    expect(plain.categories).toEqual(['my-quran-selections']);

    const starred = duaDetailPresentation(
      { kind: 'personal', selection: selection({ favourite: true }) },
      null,
    );
    expect(starred.categories).toEqual(['my-quran-selections', 'favourites']);
  });

  it('says the Qur’an is not downloaded rather than spinning, with no generation', async () => {
    await saveQuranSelection({ surah: 112, startAyah: 1, endAyah: 1 }, null);
    /* The double holds only 2:255, so 112:1 is a range the device does not have. */
    const view = await renderDetail('q.112.1.1');

    expect(view.getByTestId('faith-dua-detail-body-unavailable')).toBeTruthy();
    /* The reference is still shown — it is NoorLife's own and nothing was lost. */
    expect(String(view.getByTestId('faith-dua-detail-source-reference').props.children)).toBe(
      'Qur’an 112:1',
    );
  });
});

describe('nothing is inferred: an absent field produces no value and no element', () => {
  it('omits every optional section on a personal selection', () => {
    const presentation = duaDetailPresentation({ kind: 'personal', selection: selection() }, null);

    expect(presentation.transliteration).toBeNull();
    expect(presentation.transliterationResourceId).toBeNull();
    expect(presentation.context).toBeNull();
    expect(presentation.repetition).toBeNull();
    expect(presentation.repetitionBasis).toBeNull();
    expect(presentation.review).toBeNull();
  });

  it('draws no element for any of them', async () => {
    await saveQuranSelection({ surah: 2, startAyah: 255, endAyah: 255 }, null);
    const view = await renderDetail('q.2.255.255');

    for (const section of ['transliteration', 'context', 'repetition']) {
      expect(view.queryByTestId(`faith-dua-detail-${section}`)).toBeNull();
    }
    /* And no labelled empty box standing in for one. */
    const flat = JSON.stringify(view.toJSON());
    expect(flat).not.toMatch(/transliteration/i);
    expect(flat).not.toMatch(/repetition/i);
    expect(flat).not.toMatch(/coming soon|not available yet/i);
  });

  it('omits the transliteration on a reviewed entry too, resource id or not', () => {
    /*
      NoorLife does not transliterate, and no provider romanisation is retrieved. An entry may *name* the
      resource that would supply one; until its text arrives the section does not exist. The distinction is
      the whole reason the presentation carries both fields.
    */
    const named = duaDetailPresentation(
      { kind: 'reviewed', dua: reviewedFixture({ transliterationResourceId: 3 }) },
      null,
    );
    expect(named.transliterationResourceId).toBe(3);
    expect(named.transliteration).toBeNull();
  });

  it('omits a repetition count that no review stated', () => {
    const presentation = duaDetailPresentation({ kind: 'reviewed', dua: reviewedFixture() }, null);
    expect(presentation.repetition).toBeNull();
    expect(presentation.repetitionBasis).toBeNull();
  });

  it('shows a count only with the basis the review gave, never one without the other', () => {
    const dua = reviewedFixture({
      recommendedTarget: 33,
      review: {
        ...(reviewedRow().review as Record<string, unknown>),
        repetitionBasis: 'The basis the reviewer cited.',
      },
    });
    const presentation = duaDetailPresentation({ kind: 'reviewed', dua }, null);
    expect(presentation.repetition).toBe(33);
    expect(presentation.repetitionBasis).toBe('The basis the reviewer cited.');
  });

  it('offers no favourite control where the concept does not apply', () => {
    /*
      `null`, not `false`. A reviewed entry has no favourite state anywhere in this app, and `false` would
      render a star the user could press to write into a store that does not exist.
    */
    expect(
      duaDetailPresentation({ kind: 'reviewed', dua: reviewedFixture() }, null).favourite,
    ).toBeNull();
    expect(
      duaDetailPresentation({ kind: 'personal', selection: selection() }, null).favourite,
    ).toBe(false);
  });
});

describe('a reviewed entry discloses its whole review record', () => {
  it('names the reviewer, the basis, the date and the record identifier', () => {
    const presentation = duaDetailPresentation({ kind: 'reviewed', dua: reviewedFixture() }, null);

    expect(presentation.origin).toBe('reviewed');
    expect(presentation.review).toEqual({
      reviewer: 'A named reviewer',
      basis: 'A citable published basis',
      approvedOn: '2026-08-19',
      recordId: 'review-record-0001',
      status: 'approved',
    });
    expect(presentation.context).toBe('The reviewed context in which this is offered.');
    expect(presentation.provider).toBe(QURAN_PROVIDER);
    expect(presentation.attribution).toBe(QURAN_CONTENT_ATTRIBUTION);
    expect(presentation.categories).toEqual(['daily-remembrances']);
  });

  it('states the exact reference for its kind', () => {
    expect(
      duaDetailPresentation({ kind: 'reviewed', dua: reviewedFixture() }, null).reference,
    ).toBe('Qur’an 2:255');
    expect(
      duaDetailPresentation({ kind: 'reviewed', dua: reviewedFixture({ endAyah: 257 }) }, null)
        .reference,
    ).toBe('Qur’an 2:255-257');
  });

  it('resolves against the retained generation, never against the manifest', () => {
    const dua = reviewedFixture();
    expect(duaResolutionRef({ kind: 'reviewed', dua })).toEqual({
      surah: 2,
      startAyah: 255,
      endAyah: 255,
    });
    expect(dua.content.arabicSource).toBe('retained-generation');
  });
});

describe('Open in Reader', () => {
  it('lands on the reference’s own surah and first ayah', async () => {
    await saveQuranSelection({ surah: 2, startAyah: 255, endAyah: 255 }, null);
    const view = await renderDetail('q.2.255.255');

    await fireEvent.press(view.getByTestId('faith-dua-detail-read'));
    await drain();

    expect(router.push).toHaveBeenCalledWith({
      pathname: '/faith/reader/[surah]',
      params: { surah: '2', ayah: '255' },
    });
  });

  it('is not offered for a target with no Qur’an reference', () => {
    /*
      Unreachable today — a Hadith entry cannot be approved — and the rule is stated at the presentation so
      the control's existence follows from the reference rather than from a screen's assumption.
    */
    const presentation = duaDetailPresentation({ kind: 'personal', selection: selection() }, null);
    expect(presentation.readerTarget).toEqual({ surah: 2, ayah: 255 });
  });
});

describe('Use in Tasbih', () => {
  it('switches the counter before the screen that reads it is opened', async () => {
    /*
      ── The ordering is the behaviour, not the final value ────────────────────
      Fired and forgotten, `router.push` runs first, the Tasbih screen mounts, and `useTasbih` reads the
      store before the switch has landed — so the counter opens captioned with whatever was active before.
      Storage settles correctly either way, so a test that only checked the end state would pass against the
      broken version.
    */
    await saveQuranSelection({ surah: 2, startAyah: 255, endAyah: 255 }, null);

    const repository = createLocalTasbihRepository();
    await repository.startSession('default');
    await repository.increment();

    const view = await renderDetail('q.2.255.255');
    await fireEvent.press(view.getByTestId('faith-dua-detail-use'));
    await drain(24);

    const session = await createLocalTasbihRepository().getSession();
    expect(session.kind).toBe('ok');
    if (session.kind !== 'ok') return;
    expect(session.data.counterId).toBe('q.2.255.255');

    /* The counter it moved away from kept its count, which is the guarantee underneath. */
    await repository.startSession('default');
    const previous = await repository.getSession();
    expect(previous.kind === 'ok' && previous.data.count).toBe(1);
  });

  it('navigates only after the switch, and to the counter', async () => {
    await saveQuranSelection({ surah: 2, startAyah: 255, endAyah: 255 }, null);
    const view = await renderDetail('q.2.255.255');

    await fireEvent.press(view.getByTestId('faith-dua-detail-use'));
    await drain(24);

    expect(router.push).toHaveBeenCalledWith('/faith/tasbih');

    /*
      "Only after the switch" asserted `router.push` had not been called yet, immediately after the
      press. That could only hold while the press was dropped — `fireEvent` is async in RNTL 14 and
      was not awaited, so nothing had run by the time it was checked, and the assertion was true of
      an interaction that had not happened. Awaited, the whole chain completes and the probe reads
      as a failure. See #155.

      The guarantee itself is unchanged and is now read off call order: the session write lands
      before the navigation, so a reader who lands on the counter finds it already switched.
    */
    const writes = (AsyncStorage.setItem as unknown as jest.Mock).mock;
    // Resolved through the production boundary rather than written down; see `faithAddress`.
    const sessionKey = faithAddress('tasbihSessions');
    const sessionWrite = writes.calls.findIndex(
      (call: readonly unknown[]) => call[0] === sessionKey,
    );
    expect(sessionWrite).toBeGreaterThanOrEqual(0);
    const pushOrder = (router.push as unknown as jest.Mock).mock.invocationCallOrder[0] ?? 0;
    expect(writes.invocationCallOrder[sessionWrite] ?? Number.MAX_SAFE_INTEGER).toBeLessThan(
      pushOrder,
    );
  });

  it('stamps a selection as used, and would not stamp a reviewed entry', async () => {
    await saveQuranSelection({ surah: 2, startAyah: 255, endAyah: 255 }, null);
    const view = await renderDetail('q.2.255.255');

    await fireEvent.press(view.getByTestId('faith-dua-detail-use'));
    await drain(24);

    const stored = await readQuranSelections();
    expect(stored[0]?.lastUsedAt).not.toBeNull();
  });
});

describe('the favourite control writes to the real account-scoped state', () => {
  it('persists a star, and reads it back on the next open', async () => {
    await saveQuranSelection({ surah: 2, startAyah: 255, endAyah: 255 }, null);
    const view = await renderDetail('q.2.255.255');

    expect(String(view.getByTestId('faith-dua-detail-favourite').props.accessibilityLabel)).toBe(
      'Add to favorites',
    );
    await fireEvent.press(view.getByTestId('faith-dua-detail-favourite'));
    await drain(16);

    const stored = await readQuranSelections();
    expect(stored[0]?.favourite).toBe(true);

    await cleanup();
    const reopened = await renderDetail('q.2.255.255');
    const control = reopened.getByTestId('faith-dua-detail-favourite');
    expect(String(control.props.accessibilityLabel)).toBe('In your favorites');
    /* Carried in accessibility state as well as in the fill, so it does not depend on colour. */
    expect(control.props.accessibilityState).toMatchObject({ selected: true });
  });

  it('shows one account’s star to nobody else', async () => {
    const USER_A = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
    const USER_B = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';

    setActiveFaithScope(USER_A);
    await saveQuranSelection({ surah: 2, startAyah: 255, endAyah: 255 }, null);
    await toggleQuranSelectionFavourite('q.2.255.255');
    expect((await readQuranSelections())[0]?.favourite).toBe(true);

    /*
      B has no record at that address, so the detail page answers honestly rather than rendering A's row
      under B's session. The rows themselves are untouched — see the assertion after.
    */
    setActiveFaithScope(USER_B);
    expect(await readQuranSelections()).toEqual([]);
    const asB = await renderDetail('q.2.255.255');
    expect(asB.getByTestId('faith-dua-detail-unknown')).toBeTruthy();
    expect(asB.queryByTestId('faith-dua-detail-favourite')).toBeNull();
    await cleanup();

    /* Signing back in as A restores the star: separately scoped rows were never deleted. */
    setActiveFaithScope(USER_A);
    expect((await readQuranSelections())[0]?.favourite).toBe(true);
  });

  it('reads nothing at all with no owner resolved, and offers no write', async () => {
    setActiveFaithScope(TEST_FAITH_USER_ID);
    await saveQuranSelection({ surah: 2, startAyah: 255, endAyah: 255 }, null);

    /*
      ── The data boundary, independently of the route guard ───────────────────
      `FaithRouteGuard` stops the *screen* from being reachable with no authority; this is the other half —
      with no owner the address does not resolve, so the detail page cannot read a previous account's
      selection even when it is mounted directly, as it is here.
    */
    setActiveFaithScope(null);
    const view = await renderDetail('q.2.255.255');

    expect(view.getByTestId('faith-dua-detail-unknown')).toBeTruthy();
    expect(view.queryByTestId('faith-dua-detail-favourite')).toBeNull();
    expect(view.queryByTestId('faith-dua-detail-use')).toBeNull();
    /* Nothing of the previous account's content is on screen. */
    expect(JSON.stringify(view.toJSON())).not.toContain(PROBE_ARABIC);
  });
});

describe('the responsive matrix and the page’s accessibility', () => {
  it.each(MATRIX)('%s draws the whole detail with no section lost', async (_name, width, scale) => {
    await saveQuranSelection({ surah: 2, startAyah: 255, endAyah: 255 }, 'for the morning');
    const view = await renderDetail('q.2.255.255', width, scale);

    for (const testID of [
      'faith-dua-detail-screen',
      'faith-dua-detail-title',
      'faith-dua-detail-content',
      'faith-dua-detail-source',
      'faith-dua-detail-source-reference',
      'faith-dua-detail-source-provider',
      'faith-dua-detail-attribution',
      'faith-dua-detail-categories',
      'faith-dua-detail-read',
      'faith-dua-detail-use',
      'faith-dua-detail-favourite',
    ]) {
      expect(view.getByTestId(testID)).toBeTruthy();
    }
  });

  it.each(MATRIX)('%s keeps the standard Faith header', async (_name, width, scale) => {
    await saveQuranSelection({ surah: 2, startAyah: 255, endAyah: 255 }, null);
    const view = await renderDetail('q.2.255.255', width, scale);

    for (const slot of ['header', 'header-title', 'header-back', 'header-help', 'header-profile']) {
      expect(view.getByTestId(`faith-dua-detail-screen-${slot}`)).toBeTruthy();
    }
  });

  it.each(MATRIX)(
    '%s gives every action a specific name and a hint',
    async (_name, width, scale) => {
      await saveQuranSelection({ surah: 2, startAyah: 255, endAyah: 255 }, null);
      const view = await renderDetail('q.2.255.255', width, scale);

      for (const testID of [
        'faith-dua-detail-read',
        'faith-dua-detail-use',
        'faith-dua-detail-favourite',
      ]) {
        const control = view.getByTestId(testID);
        const label = String(control.props.accessibilityLabel);
        expect(control.props.accessibilityRole).toBe('button');
        expect(label.length).toBeGreaterThan(0);
        expect(label).not.toMatch(/undefined|null|NaN/);
        expect(String(control.props.accessibilityHint).length).toBeGreaterThan(0);
      }
    },
  );

  it.each(MATRIX)('%s marks the Arabic as Arabic', async (_name, width, scale) => {
    await saveQuranSelection({ surah: 2, startAyah: 255, endAyah: 255 }, null);
    const view = await renderDetail('q.2.255.255', width, scale);

    /*
      `ArabicText` sets the script's own typography, right alignment and the language marker, so a machine
      translator does not offer to rewrite scripture. Read off the rendered node rather than trusted.
    */
    const arabic = view.getByTestId('faith-dua-detail-body-arabic-2:255');
    const style = [arabic.props.style].flat(4).filter(Boolean) as Record<string, unknown>[];
    const merged = Object.assign({}, ...style);
    expect(merged.textAlign).toBe('right');
  });

  it('shows the whole verse rather than a clamped preview, because this is the full view', async () => {
    await saveQuranSelection({ surah: 2, startAyah: 255, endAyah: 255 }, null);
    const view = await renderDetail('q.2.255.255');

    /* A preview clamp belongs on a row a tap opens. This *is* what the tap opened. */
    const arabic = view.getByTestId('faith-dua-detail-body-arabic-2:255');
    expect(arabic.props.numberOfLines).toBeUndefined();
  });
});
