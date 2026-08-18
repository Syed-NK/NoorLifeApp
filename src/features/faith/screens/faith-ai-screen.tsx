import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { AppIcon, PressableScale } from '@ds/components';
import { fontFamilies } from '@ds/tokens';
import { ModuleStatusBanner, ModuleText } from '@features/modules/components';
import { ModuleCard } from '@features/modules/components/module-card';
import { useModuleTheme } from '@features/modules/module-context';
import { moduleLayout, moduleNeutrals } from '@features/modules/module-tokens';
import { useModuleMetrics } from '@features/modules/use-module-metrics';

import { ArabicText } from '../components/faith-list';
import { FaithScreen } from '../components/faith-screen';
import { SourceBadge } from '../components/faith-states';
import type { FaithAiReply, FaithQuote } from '../data/faith-ai.repository';
import { useFaithRepositories } from '../di/faith-repository-context';
import { faithNavKeys } from '../faith-routes';

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
  const [draft, setDraft] = useState('');
  const [turns, setTurns] = useState<
    readonly { readonly question: string; readonly reply: FaithAiReply }[]
  >([]);
  const [busy, setBusy] = useState(false);

  const suggestions = ['When is my next prayer?', 'Explain this ayah', 'Summarise my week'];

  const ask = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (trimmed === '' || busy) {
        return;
      }
      setBusy(true);
      setDraft('');
      const result = await ai.ask({ text: trimmed, fromScreen: '/faith/ai' });
      if (result.kind === 'ok') {
        setTurns((current) => [{ question: trimmed, reply: result.data }, ...current]);
      }
      setBusy(false);
    },
    [ai, busy],
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
        <AskField value={draft} onChange={setDraft} onSubmit={() => void ask(draft)} busy={busy} />

        {turns.length === 0 ? (
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
        ) : null}

        {turns.map((turn, index) => (
          <TurnView key={`${index}-${turn.question}`} question={turn.question} reply={turn.reply} />
        ))}
      </View>
    </FaithScreen>
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
          minHeight: dp(moduleLayout.minTouchTarget),
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
                  minHeight: dp(moduleLayout.minTouchTarget),
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
      <SourceBadge source={quote.source} testID={`faith-ai-quote-${quote.reference}`} />
    </View>
  );
}

const styles = StyleSheet.create({
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
