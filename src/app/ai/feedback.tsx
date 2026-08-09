import { NoorAIFeedbackScreen } from '@features/modules/noor-ai/noor-ai-feedback-screen';

/**
 * `/ai/feedback` — §6's "Report or rate response" route.
 *
 * Deliberately inert. There is no approved storage, endpoint, privacy classification or retention
 * period for a report, and the answer identifier §H.5 says a report should carry is one the AI-4
 * adapter deliberately does not expose. The screen says so and accepts nothing; see
 * `noor-ai-feedback-screen.tsx` for the full reasoning and the decision that remains open.
 */
export default function Screen() {
  return <NoorAIFeedbackScreen />;
}
