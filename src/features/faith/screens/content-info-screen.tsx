import { useRouter } from 'expo-router';
import { useCallback } from 'react';
import { View } from 'react-native';

import { ModuleText } from '@features/modules/components';
import { ModuleCard } from '@features/modules/components/module-card';
import { moduleLayout } from '@features/modules/module-tokens';
import { useModuleMetrics } from '@features/modules/use-module-metrics';

import { FaithRow, FaithRowGroup } from '../components/faith-list';
import { FaithResourceView, FaithScreen } from '../components/faith-screen';
import { hasData, type FaithResult } from '../data/faith-result';
import type { ReciterEdition, TranslationEdition } from '../data/quran-content.repository';
import { MAX_CACHE_AGE_MS } from '../data/quran-foundation/quran-foundation.contract';
import { attributionForReciter } from '../data/quran-foundation/recitation-attribution';
import { useFaithRepositories } from '../di/faith-repository-context';
import { faithNavKeys, faithRoutes } from '../faith-routes';
import { useFaithPreferences } from '../hooks/use-faith-preferences';
import { useTranslationPreference } from '../hooks/use-translation-preference';
import { useFaithResource } from '../hooks/use-faith-resource';

/**
 * Where NoorLife's Faith content comes from.
 *
 * ── Why this screen exists ──────────────────────────────────────────────────
 * Attribution used to be a badge reading `Source: Quran Foundation Content API`, pinned above the
 * scripture on three reading surfaces. That is a technical fact about an integration, presented to
 * somebody who opened the app to read — and it crowded out the attribution that actually matters,
 * which is *whose translation* and *whose recitation* they are hearing.
 *
 * So attribution was split by audience. The translator's name travels with the translation and the
 * reciter's name with the audio, on the screens where a reader can act on them. Everything else —
 * the acknowledgment Quran Foundation is owed, what is licensed and what is still sample data, how
 * long anything is kept — lives here, one tap from More, where somebody looking for it will find it
 * and nobody else has to scroll past it.
 *
 * Nothing on this screen is decorative. Every line is either an acknowledgment NoorLife owes or a
 * statement about what the user is reading.
 */

type ContentInfo = {
  readonly translation: TranslationEdition | null;
  /** The stored id, kept even when no edition matched it — see `TranslationLine`. */
  readonly translationId: string | null;
  readonly reciter: ReciterEdition | null;
  readonly reciterId: string;
};

export function ContentInfoScreen() {
  return (
    <FaithScreen
      title="About this content"
      activeKey={faithNavKeys.more}
      testID="faith-content-info"
    >
      <ContentInfoBody />
    </FaithScreen>
  );
}

/** Split out so it renders inside the scaffold's `ModuleProvider`. */
function ContentInfoBody() {
  const router = useRouter();
  const { dp } = useModuleMetrics();
  const { quran, hadith, dua, mosque } = useFaithRepositories();
  const { preferences } = useFaithPreferences();
  const { translation: chosenTranslation } = useTranslationPreference();

  void hadith;
  void dua;
  void mosque;

  const info = useFaithResource(
    `faith.content-info.${chosenTranslation?.id ?? 'unresolved'}.${preferences.reciterId}`,
    useCallback(async (): Promise<FaithResult<ContentInfo>> => {
      const [translations, reciters] = await Promise.all([
        quran.availableTranslations(),
        quran.availableReciters(),
      ]);

      /**
       * A catalogue that failed to load is not an error for this screen.
       *
       * The acknowledgment, the licence terms and the sample-data notice below are all true whether
       * or not the network answered. Failing the whole screen because an edition name could not be
       * resolved would hide the part that never depends on a request — so the lookup degrades to
       * `null` and `TranslationLine` says what it does and does not know.
       */
      /**
       * The catalogue entry first, then the stored choice.
       *
       * The stored choice carries the same four fields the catalogue does — that is why it is stored
       * whole — so an offline reader now sees "The Clear Quran, translated by Dr. Mustafa Khattab"
       * rather than the bare "Edition 131 — details could not be loaded" this screen used to show.
       */
      const catalogued = hasData(translations)
        ? translations.data.find((edition) => edition.id === chosenTranslation?.id)
        : undefined;
      const translation = catalogued ?? chosenTranslation;
      const reciter = hasData(reciters)
        ? (reciters.data.find((edition) => edition.id === preferences.reciterId) ?? null)
        : null;

      return {
        kind: 'ok',
        data: {
          translation,
          translationId: chosenTranslation?.id ?? null,
          reciter,
          reciterId: preferences.reciterId,
        },
      };
    }, [quran, chosenTranslation, preferences.reciterId]),
  );

  const cacheDays = Math.round(MAX_CACHE_AGE_MS / (24 * 60 * 60 * 1000));

  return (
    <View style={{ rowGap: dp(moduleLayout.sectionGap) }}>
      <FaithResourceView
        resource={info}
        empty={{ title: 'No content information', body: 'Nothing could be resolved.' }}
        loadingRows={2}
        testID="faith-content-info-body"
      >
        {(value) => (
          <FaithRowGroup title="What you are reading" testID="faith-content-info-editions">
            {[
              <TranslationLine key="translation" info={value} />,
              <ReciterLine key="reciter" info={value} />,
              <FaithRow
                key="change"
                title="Change translation or reciter"
                subtitle="Your choice is credited wherever it appears"
                icon="settings"
                onPress={() => router.push(faithRoutes.preferences)}
                testID="faith-content-info-preferences"
              />,
            ]}
          </FaithRowGroup>
        )}
      </FaithResourceView>

      {/*
        The acknowledgment. Discreet by placement rather than by being small — it is a full,
        readable statement on a screen somebody opened to read it, which is more respectful of the
        obligation than a five-word chip nobody reads.
      */}
      <ModuleCard testID="faith-content-info-quran-foundation">
        <View style={{ rowGap: dp(6) }}>
          <ModuleText token="cardTitle" numberOfLines={2} accessibilityRole="header">
            Qur’an text and translations
          </ModuleText>
          <ModuleText token="body" numberOfLines={6}>
            Qur’anic Arabic, translations and recitation details are provided by the Quran
            Foundation Content API. NoorLife renders the Arabic exactly as received — it is never
            edited, normalised or machine-translated — and every translation is credited to the
            edition and translator you selected.
          </ModuleText>
          <ModuleText token="caption" numberOfLines={4}>
            {`Content is kept on this device for at most ${cacheDays} days so it can be read offline, then re-fetched.`}
          </ModuleText>
        </View>
      </ModuleCard>

      {/*
        The honest inventory. A user who has seen a "sample content" warning on one screen deserves
        to be able to find out, in one place, exactly which parts of the module that applies to.
      */}
      <ModuleCard testID="faith-content-info-scope">
        <View style={{ rowGap: dp(6) }}>
          <ModuleText token="cardTitle" numberOfLines={2} accessibilityRole="header">
            What is licensed, and what is not
          </ModuleText>
          <ModuleText token="body" numberOfLines={8}>
            Qur’an content is licensed. Hadith narrations, duas and mosque listings are sample data
            while their sources are being arranged, and every screen showing them says so.
          </ModuleText>
          <ModuleText token="body" numberOfLines={4}>
            Searching the Qur’an is not available. NoorLife’s access covers Qur’an content only, not
            the search service, so search covers narrations and duas.
          </ModuleText>
        </View>
      </ModuleCard>
    </View>
  );
}

/**
 * The active translation, named.
 *
 * The three cases are genuinely different and are worded as such: an edition that resolved, an
 * edition that did not (offline, or a stored id the catalogue no longer offers), and the fact that
 * the id is shown in the second case so a support conversation has something to go on.
 */
function TranslationLine({ info }: { readonly info: ContentInfo }) {
  if (info.translation === null) {
    /*
      No edition has been resolved at all — a fresh install whose catalogue read has not landed, or
      one where no English edition validated. Naming an id here would be naming something the user
      has never been shown.
    */
    const subtitle =
      info.translationId === null
        ? 'No translation chosen yet'
        : `Edition ${info.translationId} — details could not be loaded`;
    return (
      <FaithRow
        title="Translation"
        subtitle={subtitle}
        icon="quran"
        accessibilityLabel={`Translation, ${subtitle}`}
        testID="faith-content-info-translation"
      />
    );
  }

  return (
    <FaithRow
      title={info.translation.name}
      subtitle={`Translated by ${info.translation.translator} • ${info.translation.language}`}
      icon="quran"
      accessibilityLabel={`Translation: ${info.translation.name}, translated by ${info.translation.translator}, in ${info.translation.language}`}
      testID="faith-content-info-translation"
    />
  );
}

function ReciterLine({ info }: { readonly info: ContentInfo }) {
  if (info.reciter === null) {
    return (
      <FaithRow
        title="Recitation"
        subtitle={`Reciter ${info.reciterId} — details could not be loaded`}
        icon="worship"
        accessibilityLabel={`Recitation, reciter ${info.reciterId}, details could not be loaded`}
        testID="faith-content-info-reciter"
      />
    );
  }

  /**
   * The required credit, for resource 3 only.
   *
   * Quran Foundation granted NoorLife written permission covering Abdur-Rahman as-Sudais and stipulated
   * this exact wording. It replaces the generic subtitle rather than sitting beside it: two credits for
   * one recitation reads as indecision, and the mandated sentence already names the reciter.
   *
   * `attributionForReciter` returns `null` for every other id, so no other reciter inherits either the
   * wording or the impression of a bespoke permission.
   */
  const required = attributionForReciter(info.reciterId);

  return (
    <FaithRow
      title={info.reciter.name}
      subtitle={
        required ??
        (info.reciter.style === undefined ? 'Recitation' : `Recitation • ${info.reciter.style}`)
      }
      icon="worship"
      accessibilityLabel={
        required ??
        `Recitation by ${info.reciter.name}${info.reciter.style === undefined ? '' : `, ${info.reciter.style}`}`
      }
      testID="faith-content-info-reciter"
    />
  );
}
