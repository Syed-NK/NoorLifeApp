import AsyncStorage from '@react-native-async-storage/async-storage';
import { render, screen, fireEvent } from '@testing-library/react-native';
import React from 'react';

import { seedTranslationPreference } from '@/test-support/faith-preferences-fixtures';
import { warmUpFirstMount } from '@/test-support/mock-latency-timers';
import { ModuleHomeScreen } from '@features/modules/screens/module-home-screen';

import { mockRouter } from '../../../../jest.setup';

import type { FaithRepositories } from '../data';
import type { AyahText, AyahTranslation } from '../data/quran-content.repository';
import { createMockFaithRepositories } from '../data/mock';
import { FaithRepositoryProvider } from '../di/faith-repository-context';

/**
 * Verse of the day is a preview, and its height does not depend on which verse it drew.
 *
 * ── The divergence these lock out ───────────────────────────────────────────
 * The Arabic carried no line clamp, so the card's height was the height of the verse. On a day the
 * rotation landed on 2:286 — the longest ayah in the Qur'an — the card ran past 500 dp, and because
 * Verse and Worship share a row, Worship stretched to match an emptiness it had nothing to fill.
 * The Ramadan, Islamic Calendar and Faith AI cards were pushed off the screen by a single day's
 * verse, which made the home screen's composition a function of the calendar.
 *
 * ── Why these tests use the longest verse ───────────────────────────────────
 * A repository double returning 2:286 is the case that broke it. Asserting on a short verse would
 * pass against the old implementation too.
 */

warmUpFirstMount(() => renderHome());

/** 2:286 — the longest ayah, and the one that exposed the unbounded card. */
const LONG_ARABIC =
  'لَا يُكَلِّفُ ٱللَّهُ نَفْسًا إِلَّا وُسْعَهَا ۚ لَهَا مَا كَسَبَتْ وَعَلَيْهَا مَا ٱكْتَسَبَتْ ۗ رَبَّنَا لَا تُؤَاخِذْنَآ إِن نَّسِينَآ أَوْ أَخْطَأْنَا ۚ رَبَّنَا وَلَا تَحْمِلْ عَلَيْنَآ إِصْرًا كَمَا حَمَلْتَهُۥ عَلَى ٱلَّذِينَ مِن قَبْلِنَا ۚ رَبَّنَا وَلَا تُحَمِّلْنَا مَا لَا طَاقَةَ لَنَا بِهِۦ ۖ وَٱعْفُ عَنَّا وَٱغْفِرْ لَنَا وَٱرْحَمْنَآ';

const LONG_TRANSLATION =
  'God does not burden any soul with more than it can bear: each gains whatever good it has done, and suffers its bad. Lord, do not take us to task if we forget or make mistakes. Lord, do not burden us as You burdened those before us. Lord, do not burden us with more than we have strength to bear. Pardon us, forgive us, and have mercy on us.';

function withLongVerse(): Partial<FaithRepositories> {
  const base = createMockFaithRepositories();
  return {
    ...base,
    quran: {
      ...base.quran,
      /*
        The branded `SurahNumber`/`AyahNumber`/`TranslationId` types exist to stop an arbitrary
        integer reaching the reader. A test double is the one place a literal is legitimate, so the
        cast is confined here rather than the domain being loosened for it.
      */
      getAyahOfTheDay: async () => ({
        kind: 'ok' as const,
        data: {
          text: {
            surah: 2 as AyahText['surah'],
            ayah: 286 as AyahText['ayah'],
            arabic: LONG_ARABIC,
            source: base.quran.source,
          },
          translation: {
            surah: 2 as AyahText['surah'],
            ayah: 286 as AyahText['ayah'],
            translationId: '131' as AyahTranslation['translationId'],
            text: LONG_TRANSLATION,
            translator: 'M.A.S. Abdel Haleem',
            source: base.quran.source,
          },
        },
      }),
    },
  };
}

async function renderHome(repositories?: Partial<FaithRepositories>) {
  await render(
    <FaithRepositoryProvider repositories={{ ...createMockFaithRepositories(), ...repositories }}>
      <ModuleHomeScreen moduleId="faith" />
    </FaithRepositoryProvider>,
  );
  return screen;
}

beforeEach(async () => {
  await AsyncStorage.clear();
  await seedTranslationPreference();
});

describe('the verse preview is clamped', () => {
  it('does not let a long verse set the card’s height', async () => {
    await renderHome(withLongVerse());
    const arabic = await screen.findByTestId('faith-ayah-arabic');

    /*
      A line count, not a height. The card's height is then a function of the clamp and the user's
      type size — not of how many words the day's ayah happens to have.
    */
    /*
      Three, measured rather than chosen: at four the pair rendered 226 dp against a 190–220 dp
      target and pushed the Faith AI card under the fold.
    */
    expect(arabic.props.numberOfLines).toBe(3);
    expect(arabic.props.ellipsizeMode).toBe('tail');
  });

  it('clamps the translation preview too', async () => {
    await renderHome(withLongVerse());
    const translation = await screen.findByText(new RegExp(LONG_TRANSLATION.slice(0, 24)));

    expect(translation.props.numberOfLines).toBe(2);
  });

  /**
   * A clamp is a *presentational* cut, never a shortened source.
   *
   * The repository returns the whole verse and the whole translation; the card renders all of it and
   * lets the platform decide where to stop. That is what lets the reader open with the full text and
   * no second request, and it is why the clamp cannot lose anything.
   */
  it('still holds the complete verse behind the clamp', async () => {
    await renderHome(withLongVerse());
    const arabic = await screen.findByTestId('faith-ayah-arabic');

    expect(String(arabic.props.children)).toBe(LONG_ARABIC);
  });

  it('keeps the surah and ayah reference visible', async () => {
    await renderHome(withLongVerse());
    expect(await screen.findByText('Surah 2:286')).toBeTruthy();
  });
});

describe('the card opens the verse it previewed', () => {
  it('routes to the reader at the live surah and ayah', async () => {
    await renderHome(withLongVerse());
    const card = await screen.findByTestId('faith-ayah');

    await fireEvent.press(card);
    expect(mockRouter.push).toHaveBeenCalled();
  });

  /**
   * The spoken description is not the clamped preview.
   *
   * A screen-reader user must not be handed the visual truncation as though it were the verse. The
   * label names the surah and ayah, says the preview is partial, and says what a tap does.
   */
  it('describes the preview as partial rather than reading a cut verse', async () => {
    await renderHome(withLongVerse());
    const card = await screen.findByTestId('faith-ayah');
    const spoken = String(card.props.accessibilityLabel);

    expect(spoken).toMatch(/Surah 2, ayah 286/);
    expect(spoken).toMatch(/Preview only/i);
    expect(spoken).toMatch(/complete verse/i);
    // Not the Arabic itself: a home card announcing a whole ayah on focus buries the six around it.
    expect(spoken).not.toContain(LONG_ARABIC);
  });
});

describe('the compact home composition survives a long verse', () => {
  it('keeps Upcoming, the Islamic Calendar and the AI card reachable', async () => {
    await renderHome(withLongVerse());

    // All three sit below the Verse/Worship row; none is conditional on the verse's length.
    expect(await screen.findByTestId('faith-upcoming')).toBeTruthy();
    expect(await screen.findByTestId('faith-calendar')).toBeTruthy();
    expect(await screen.findByTestId('faith-insight')).toBeTruthy();
  });

  it('keeps Today’s Worship beside it with its own action', async () => {
    await renderHome(withLongVerse());

    expect(await screen.findByTestId('faith-worship')).toBeTruthy();
    expect(await screen.findByText('View All')).toBeTruthy();
  });
});
