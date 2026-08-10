/**
 * Noor AI's home-screen copy.
 *
 * ── What this file used to be, and why it shrank ────────────────────────────
 * It was a typed *fixture* of the whole reference screen: four capability cards, three "Today's
 * Suggestions" rows, and a "Recent Conversations" list of three invented questions with invented
 * timestamps. AI-5's emulator pass captured that screen and the fabrication was plain in the
 * screenshot: a list headed **Recent Conversations** reading "How can I improve my productivity? —
 * Yesterday, 9:21 PM", one tap from a chat surface whose own caption says *"Nothing here is saved."*
 *
 * Nothing produced those rows. There is no conversation store — `AI_CONVERSATION_STORAGE_EXISTS` is
 * `false`, conversation persistence is **AI-8's** behind a reviewed schema, an RLS policy, a
 * retention period and an export and deletion path — so the list was not an empty state waiting for
 * data, it was three sentences that had never been asked, presented as the user's own history.
 *
 * The suggestions and three of the four capability cards failed the same rule from the opposite
 * direction: "Explain my progress", "Help me plan", "Review my day", "Balance my week" and "Family
 * activity idea" all describe Noor AI reading module records, and AI-1 reads none. §12.8's rule is
 * that AI-5 enables **only capabilities AI-1's server can actually serve**, and those were promises
 * dressed as controls.
 *
 * ── What is left ────────────────────────────────────────────────────────────
 * The two things this build can honestly offer: the entry into the single-turn chat, and a truthful
 * statement of what Noor AI can and cannot reach. There is no history section, no fake empty state
 * claiming a history exists but is empty, no conversation id, and no storage of any kind. Anything
 * that returns here needs the capability behind it to exist first.
 */

export type NoorAIHomeCopy = {
  readonly prompt: {
    readonly placeholder: string;
  };
  readonly privacy: {
    readonly title: string;
    readonly body: string;
    readonly actionLabel: string;
  };
};

export const noorAIHomeCopy: NoorAIHomeCopy = {
  prompt: {
    placeholder: 'Ask me anything about NoorLife…',
  },
  /**
   * The scope card, stated as the fact it is rather than as a control that does not exist.
   *
   * The previous wording — "You control what Noor AI can access" / "Manage your data and permissions
   * anytime" — promised management that is not built: `AI_GRANT_EDITING_AVAILABLE` is `false` and
   * granting a module is AI-6's. What is true today is narrower and worth saying plainly, and it is
   * the same sentence the conversation screen's scope block uses, so the two cannot drift apart.
   */
  privacy: {
    title: 'Noor AI reads no module records',
    body: 'Nothing you have saved in a module is sent with your question.',
    actionLabel: 'What Noor AI can access',
  },
};
