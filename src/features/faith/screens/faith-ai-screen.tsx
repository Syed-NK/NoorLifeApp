import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Image, StyleSheet, TextInput, View } from 'react-native';

import { AppIcon, PressableScale } from '@ds/components';
import { fontFamilies } from '@ds/tokens';
import { ModuleStatusBanner, ModuleText } from '@features/modules/components';
import { ModuleCard } from '@features/modules/components/module-card';
import { useModuleTheme } from '@features/modules/module-context';
import { moduleLayout, moduleNeutrals } from '@features/modules/module-tokens';
import { useModuleMetrics } from '@features/modules/use-module-metrics';

import { ArabicText } from '../components/faith-list';
import { FaithResourceView, FaithScreen } from '../components/faith-screen';
import { FaithSectionHero } from '../components/faith-section-hero';
import { UnverifiedSourceNotice } from '../components/faith-states';
import { noorAIRobot } from '../faith-ai-assets';
import type { FaithAiReply, FaithQuote, FaithVerseContext } from '../data/faith-ai.repository';
import { hasData, type FaithResult } from '../data/faith-result';
import type { AyahText, AyahTranslation } from '../data/quran-content.repository';
import { surahNumber } from '../data/quran-content.repository';
import { useFaithRepositories } from '../di/faith-repository-context';
import { faithNavKeys } from '../faith-routes';
import { useFaithResource } from '../hooks/use-faith-resource';
import { useTranslationPreference } from '../hooks/use-translation-preference';
import { parseAyahParam, parseSurahParam } from './reader-screen';
import { minimumTouchTargetSize } from '@shared/utils/a11y';

/**
 * Faith AI.
 *
 * ── What the screen guarantees visually ─────────────────────────────────────
 * The type system already prevents the assistant from producing an out-of-scope answer or
 * an unattributed quote. This screen's job is to make the same boundaries *visible*:
 *
 *   • The assistant's own words and any quoted scripture are rendered in different
 *     containers, with the quote carrying its reference and source badge. A reader
 *     skimming cannot mistake one for the other.
 *   • A `qualified` reply renders its limitation **above** the answer, not as a footnote
 *     beneath it, because a caveat nobody reads before the answer is not a caveat.
 *   • An `out-of-scope` reply renders no answer at all — only the boundary and an offer.
 *     The hand-off is a button the user must press; it never happens on its own.
 *
 * ── Not connected ───────────────────────────────────────────────────────────
 * There is no AI backend. The banner says so, and the replies come from a keyword
 * classifier in the mock repository. The routing logic is real; the intelligence is not.
 */
export function FaithAiScreen() {
  const { dp } = useModuleMetrics();
  const { ai } = useFaithRepositories();
  const params = useLocalSearchParams<{ surah?: string; ayah?: string }>();
  const [draft, setDraft] = useState('');
  const [turns, setTurns] = useState<
    readonly { readonly question: string; readonly reply: FaithAiReply }[]
  >([]);
  const [busy, setBusy] = useState(false);

  /**
   * The verse this screen was opened about, when the reader's action sheet sent one.
   *
   * A pair of integers off the route and nothing more — see `faithAiHref` for why the scripture
   * itself is not passed through the navigation. `null` is the ordinary case: the screen is also
   * reached from the bottom navigation, where there is no verse in hand.
   */
  const context = useMemo((): FaithVerseContext | null => {
    const surah = parseSurahParam(params.surah);
    const ayah = parseAyahParam(params.ayah);
    return surah === null || ayah === null ? null : { kind: 'ayah', surah, ayah };
  }, [params.surah, params.ayah]);

  const suggestions =
    context === null
      ? ['When is my next prayer?', 'Explain this ayah', 'Summarise my week']
      : [
          `What is the meaning of aya ${context.surah}:${context.ayah}?`,
          `When was aya ${context.surah}:${context.ayah} revealed?`,
        ];

  const ask = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (trimmed === '' || busy) {
        return;
      }
      setBusy(true);
      setDraft('');
      /*
        The verse travels as `context` — a citation — rather than being pasted into `text`. A
        question with the Arabic interpolated into it would reach the assistant as user-typed prose
        with no source behind it, which is the one way scripture can enter this boundary
        unattributed.
      */
      const result = await ai.ask({
        text: trimmed,
        fromScreen: '/faith/ai',
        ...(context === null ? {} : { context }),
      });
      if (result.kind === 'ok') {
        setTurns((current) => [{ question: trimmed, reply: result.data }, ...current]);
      }
      setBusy(false);
    },
    [ai, busy, context],
  );

  return (
    <FaithScreen
      title="Faith AI"
      activeKey={faithNavKeys.ai}
      banner={
        <ModuleStatusBanner
          tone="info"
          message="Faith AI is not connected yet. Replies below are samples that demonstrate its limits."
          testID="faith-ai-banner"
        />
      }
      testID="faith-ai"
    >
      <View style={{ rowGap: dp(moduleLayout.sectionGap) }}>
        {/*
          The assistant's own hero, at the same measured geometry as the other nine Faith heroes,
          carrying the approved robot instead of a tile pictogram. Faith AI has no Faith Home tile,
          so it supplies its title, artwork and testID explicitly — see `FaithSectionHero`'s
          identity union.
        */}
        <FaithSectionHero
          title="Noor AI"
          summary="Ask about the Qur’an, prayer and practice."
          artwork={noorAIRobot}
          testID="faith-hero-ai"
        />

        {context === null ? null : <VerseContextCard context={context} />}

        <AskField value={draft} onChange={setDraft} onSubmit={() => void ask(draft)} busy={busy} />

        {turns.length === 0 ? (
          <>
            <NoorAIWelcome hasVerseContext={context !== null} />
            <View style={{ rowGap: dp(8) }}>
              <ModuleText token="cardTitle" numberOfLines={1}>
                Try asking
              </ModuleText>
              <View style={[styles.chips, { columnGap: dp(8), rowGap: dp(8) }]}>
                {suggestions.map((suggestion) => (
                  <Chip key={suggestion} label={suggestion} onPress={() => void ask(suggestion)} />
                ))}
              </View>
            </View>
          </>
        ) : null}

        {turns.map((turn, index) => (
          <TurnView key={`${index}-${turn.question}`} question={turn.question} reply={turn.reply} />
        ))}
      </View>
    </FaithScreen>
  );
}

/**
 * The assistant's welcome state — the robot, a greeting, and what it can and cannot do.
 *
 * ── Why it says what it cannot do, up front ─────────────────────────────────
 * The reference draws a warm greeting and nothing else. That would be a claim this build cannot
 * honour: there is no AI backend, replies come from a keyword classifier, and the screen's banner
 * already says so. A welcome card that promised "clear explanations with verified sources" beneath
 * that banner would contradict it in the same viewport.
 *
 * So the greeting is the reference's, and the second line is the truth about the boundary — the
 * assistant explains, and does not issue rulings. That line stays correct when the backend does
 * arrive, because it describes the scope rather than the implementation.
 *
 * ── The robot is decorative here ────────────────────────────────────────────
 * The greeting beside it already names Noor AI, so the image is `accessible={false}` rather than
 * announcing the assistant a second time to a screen reader.
 */
function NoorAIWelcome({ hasVerseContext }: { readonly hasVerseContext: boolean }) {
  const { dp } = useModuleMetrics();

  return (
    <ModuleCard tinted testID="faith-ai-welcome">
      <View style={[styles.welcome, { columnGap: dp(12) }]}>
        <Image
          source={noorAIRobot}
          style={{ width: dp(72), height: dp(108) }}
          resizeMode="contain"
          accessible={false}
          testID="faith-ai-welcome-robot"
        />
        <View style={styles.welcomeCopy}>
          <ModuleText token="cardTitle" numberOfLines={1} accessibilityRole="header">
            Assalamu alaykum
          </ModuleText>
          <ModuleText token="body">
            {hasVerseContext
              ? 'I’m Noor AI. Ask about the aya above and I’ll explain it with its source shown.'
              : 'I’m Noor AI, your faith companion. I explain — I don’t issue religious rulings.'}
          </ModuleText>
        </View>
      </View>
    </ModuleCard>
  );
}

/** The scripture and translation for one verse, resolved together so they can be shown together. */
type VerseContextContent = {
  readonly text: AyahText;
  readonly translation: AyahTranslation | null;
};

/**
 * The verse the question is about, shown at the top of the screen.
 *
 * ── Every word in this card came from the repository ────────────────────────
 * The route handed this screen two integers. The Arabic, the translation, the translator and the
 * source name below are all fetched through `QuranContentRepository` — the same approved boundary
 * the reader itself reads from, and the only one that attaches a `ContentSource` to what it
 * returns. Nothing here is passed in through navigation, held in a constant, or produced by the
 * assistant, so there is no path by which generated text could appear in this card.
 *
 * That is also why it renders *above* the composer rather than inside the conversation. A reply is
 * the assistant's own words and is drawn as such; this is the verse, drawn as scripture, before any
 * question has been asked — the two are never in the same container, which is the separation
 * `FaithQuote` enforces for quotes inside a reply.
 */
function VerseContextCard({ context }: { readonly context: FaithVerseContext }) {
  const { dp } = useModuleMetrics();
  const { quran } = useFaithRepositories();
  const { translation: edition, status: translationStatus } = useTranslationPreference();
  const editionId = edition?.id ?? null;

  const verse = useFaithResource(
    translationStatus === 'resolving'
      ? null
      : `faith.ai.verse.${context.surah}.${context.ayah}.${editionId ?? 'unresolved'}`,
    useCallback(async (): Promise<FaithResult<VerseContextContent>> => {
      const number = surahNumber(context.surah);
      const [text, translated] = await Promise.all([
        quran.listAyahs(number),
        editionId === null
          ? Promise.resolve({ kind: 'empty' as const })
          : quran.listTranslations(number, editionId),
      ]);
      if (!hasData(text)) {
        return text;
      }
      const item = text.data.items.find((entry) => entry.ayah === context.ayah);
      if (item === undefined) {
        return { kind: 'error', code: 'not-found' };
      }
      return {
        kind: 'ok',
        data: {
          text: item,
          translation: hasData(translated)
            ? (translated.data.items.find((entry) => entry.ayah === context.ayah) ?? null)
            : null,
        },
      };
    }, [quran, context.surah, context.ayah, editionId]),
  );

  return (
    <ModuleCard testID="faith-ai-verse-context">
      <View style={{ rowGap: dp(8) }}>
        {/* The citation, stated before the text, so what is being shown is never in doubt. */}
        <ModuleText
          token="cardTitle"
          accessibilityRole="header"
          testID="faith-ai-verse-context-title"
        >
          {`Aya ${context.surah}:${context.ayah}`}
        </ModuleText>

        <FaithResourceView
          resource={verse}
          empty={{
            title: 'This aya could not be loaded',
            body: 'Noor AI still works — ask your question and it will answer without the text.',
          }}
          loadingRows={2}
          testID="faith-ai-verse-context-body"
        >
          {(content) => (
            <View style={{ rowGap: dp(8) }}>
              <ArabicText testID="faith-ai-verse-context-arabic">{content.text.arabic}</ArabicText>
              {content.translation === null ? null : (
                <>
                  <ModuleText token="body" testID="faith-ai-verse-context-translation">
                    {content.translation.text}
                  </ModuleText>
                  <ModuleText token="caption" color={moduleNeutrals.textSecondary}>
                    {content.translation.source.attribution === undefined
                      ? content.translation.source.name
                      : `Translated by ${content.translation.source.attribution}`}
                  </ModuleText>
                </>
              )}
              <UnverifiedSourceNotice
                source={content.text.source}
                testID="faith-ai-verse-context"
              />
            </View>
          )}
        </FaithResourceView>
      </View>
    </ModuleCard>
  );
}

function AskField({
  value,
  onChange,
  onSubmit,
  busy,
}: {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onSubmit: () => void;
  readonly busy: boolean;
}) {
  const theme = useModuleTheme();
  const { dp } = useModuleMetrics();

  return (
    <View
      style={[
        styles.askRow,
        {
          borderRadius: dp(moduleLayout.radiusPill),
          borderColor: theme.border,
          paddingLeft: dp(14),
          paddingRight: dp(6),
          columnGap: dp(8),
          minHeight: minimumTouchTargetSize(),
        },
      ]}
    >
      <TextInput
        value={value}
        onChangeText={onChange}
        onSubmitEditing={onSubmit}
        placeholder="Ask about prayer, Qur’an or your worship"
        placeholderTextColor={moduleNeutrals.textSecondary}
        returnKeyType="send"
        editable={!busy}
        accessibilityLabel="Ask Faith AI"
        accessibilityHint="Faith AI answers only about the Faith module."
        style={[styles.input, { fontSize: dp(13), color: moduleNeutrals.textPrimary }]}
        testID="faith-ai-input"
      />
      <PressableScale
        onPress={onSubmit}
        accessibilityRole="button"
        accessibilityLabel="Send question"
        accessibilityState={{ disabled: busy }}
        style={[
          styles.send,
          {
            width: dp(36),
            height: dp(36),
            borderRadius: dp(18),
            backgroundColor: busy ? moduleNeutrals.border : theme.fill,
          },
        ]}
        testID="faith-ai-send"
      >
        <AppIcon name="send" size={dp(16)} color={theme.onFill} />
      </PressableScale>
    </View>
  );
}

function Chip({ label, onPress }: { readonly label: string; readonly onPress: () => void }) {
  const theme = useModuleTheme();
  const { dp } = useModuleMetrics();

  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[
        styles.chip,
        {
          borderRadius: dp(moduleLayout.radiusPill),
          borderColor: theme.border,
          paddingHorizontal: dp(12),
          minHeight: dp(36),
        },
      ]}
      testID={`faith-ai-chip-${label.slice(0, 12).replace(/\s+/g, '-').toLowerCase()}`}
    >
      <ModuleText token="caption" color={theme.ink} numberOfLines={1}>
        {label}
      </ModuleText>
    </PressableScale>
  );
}

function TurnView({
  question,
  reply,
}: {
  readonly question: string;
  readonly reply: FaithAiReply;
}) {
  const { dp } = useModuleMetrics();

  return (
    <View style={{ rowGap: dp(6) }} testID="faith-ai-turn">
      <ModuleCard tinted testID="faith-ai-question">
        <ModuleText token="body" numberOfLines={4}>
          {question}
        </ModuleText>
      </ModuleCard>
      <ReplyView reply={reply} />
    </View>
  );
}

function ReplyView({ reply }: { readonly reply: FaithAiReply }) {
  const router = useRouter();
  const theme = useModuleTheme();
  const { dp } = useModuleMetrics();
  const { ai } = useFaithRepositories();

  switch (reply.kind) {
    case 'answer':
      return (
        <ModuleCard testID="faith-ai-answer">
          <View style={{ rowGap: dp(8) }}>
            <ModuleText token="body" numberOfLines={12}>
              {reply.answer}
            </ModuleText>
            {reply.quotes.map((quote) => (
              <QuoteBlock key={quote.reference} quote={quote} />
            ))}
          </View>
        </ModuleCard>
      );

    case 'qualified':
      return (
        <View style={{ rowGap: dp(6) }}>
          {/* The limitation comes first, deliberately. */}
          <ModuleStatusBanner
            tone="warning"
            message={reply.limitation}
            testID="faith-ai-limitation"
          />
          <ModuleCard testID="faith-ai-qualified">
            <View style={{ rowGap: dp(8) }}>
              <ModuleText token="body" numberOfLines={12}>
                {reply.answer}
              </ModuleText>
              {reply.quotes.map((quote) => (
                <QuoteBlock key={quote.reference} quote={quote} />
              ))}
            </View>
          </ModuleCard>
        </View>
      );

    case 'out-of-scope':
      return (
        <ModuleCard testID="faith-ai-out-of-scope">
          <View style={{ rowGap: dp(8) }}>
            <ModuleText token="body" numberOfLines={3}>
              {reply.message}
            </ModuleText>
            <PressableScale
              onPress={() => {
                void ai
                  .confirmHandoff(
                    { text: reply.message, fromScreen: '/faith/ai' },
                    reply.targetModule ?? 'noor-ai',
                  )
                  .then((result) => {
                    if (result.kind === 'ok') {
                      router.push('/ai');
                    }
                  });
              }}
              accessibilityRole="button"
              accessibilityLabel={reply.handoffPrompt}
              accessibilityHint="Opens Noor AI. Nothing is sent until you tap."
              style={[
                styles.handoff,
                {
                  minHeight: minimumTouchTargetSize(),
                  borderRadius: dp(moduleLayout.radiusSmall),
                  backgroundColor: theme.fill,
                  paddingHorizontal: dp(16),
                },
              ]}
              testID="faith-ai-handoff"
            >
              <ModuleText token="button" color={theme.onFill} numberOfLines={1}>
                {reply.handoffPrompt}
              </ModuleText>
            </PressableScale>
          </View>
        </ModuleCard>
      );

    case 'refused':
      return (
        <ModuleCard testID="faith-ai-refused">
          <ModuleText token="body" numberOfLines={4}>
            {reply.message}
          </ModuleText>
        </ModuleCard>
      );
  }
}

/**
 * Quoted religious content.
 *
 * Visually distinct from the assistant's prose — an accent rule, its reference, and its
 * source badge — so the boundary between "what the assistant said" and "what the source
 * says" is a thing you can see, not a thing you have to know.
 */
function QuoteBlock({ quote }: { readonly quote: FaithQuote }) {
  const theme = useModuleTheme();
  const { dp } = useModuleMetrics();
  const isArabic = quote.kind === 'quran' || /[؀-ۿ]/.test(quote.verbatim);

  return (
    <View
      style={[
        styles.quote,
        {
          borderLeftColor: theme.border,
          paddingLeft: dp(10),
          rowGap: dp(6),
        },
      ]}
      testID={`faith-ai-quote-${quote.reference}`}
    >
      {isArabic ? (
        <ArabicText>{quote.verbatim}</ArabicText>
      ) : (
        <ModuleText token="body" numberOfLines={8}>
          {quote.verbatim}
        </ModuleText>
      )}
      <ModuleText token="caption" numberOfLines={1}>
        {quote.reference}
      </ModuleText>
      <UnverifiedSourceNotice source={quote.source} testID={`faith-ai-quote-${quote.reference}`} />
    </View>
  );
}

const styles = StyleSheet.create({
  welcome: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  welcomeCopy: {
    flex: 1,
    // Lets the copy column shrink below its content width instead of pushing the robot out of
    // the card at a large font scale.
    minWidth: 0,
  },
  askRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    backgroundColor: moduleNeutrals.surface,
  },
  input: {
    flex: 1,
    minWidth: 0,
    fontFamily: fontFamilies.regular,
    paddingVertical: 8,
  },
  send: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    backgroundColor: moduleNeutrals.surface,
  },
  handoff: {
    alignSelf: 'flex-start',
    alignItems: 'center',
    justifyContent: 'center',
  },
  quote: {
    borderLeftWidth: 3,
  },
});
