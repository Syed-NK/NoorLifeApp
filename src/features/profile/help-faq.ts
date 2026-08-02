import { PREMIUM_MODULE_IDS } from '@features/subscription/domain/entitlement';
import { productConfig } from '@shared/config/app-config';

/**
 * The six questions Help & Support answers, and the product rules the answers restate.
 *
 * ── Why the answers are assembled rather than written ───────────────────────
 * Every claim below traces to something the application actually enforces:
 *
 *   • "Faith is always free" is `PLAN_CAPABILITIES[*].faith === true`, which a subscription test
 *     asserts for every plan and status including expired.
 *   • "the other six modules" is `PREMIUM_MODULE_IDS.length`, interpolated rather than typed, so
 *     adding or removing a paid module rewrites this answer instead of contradicting it.
 *   • "Noor AI answers questions about using NoorLife" is the `noorlife` AI scope in
 *     `@shared/permissions/ai-scope` — help, navigation and module explanations, with private
 *     module data reachable only where the user has granted it.
 *
 * An FAQ is the part of an application most likely to describe a product that no longer exists.
 * Deriving the numbers is what keeps this one honest without anybody remembering to check it.
 *
 * ── `__DEV__` ───────────────────────────────────────────────────────────────
 * `developmentNotes` adds the one fact a tester needs and a user must never be shown: purchases
 * run through a mock adapter. The caller passes `__DEV__`, so the list a release build assembles
 * has never contained the wording — it is not hidden at render time, it is not in the list.
 *
 * The branch is *also* guarded by `__DEV__` directly, which is belt and braces on purpose. The
 * caller's flag is intent; the inlined constant is a guarantee. Metro replaces `__DEV__` with
 * `false` in a release bundle and drops the branch, so the strings are not merely unreachable in
 * production — they are not shipped at all, which is verifiable by searching the built bundle
 * rather than by trusting a call site.
 */

export type FaqEntry = {
  readonly key: string;
  readonly question: string;
  readonly answer: string;
  readonly testID: string;
};

export type FaqOptions = {
  /** Pass `__DEV__`. Adds facts about this build that must not ship in production copy. */
  readonly developmentNotes: boolean;
};

/** Six modules today: health, planner, finance, learning, family and goals. */
const PREMIUM_MODULE_COUNT = PREMIUM_MODULE_IDS.length;

export function helpFaq(options: FaqOptions): readonly FaqEntry[] {
  const entries: FaqEntry[] = [
    {
      key: 'what-is-noorlife',
      question: `What is ${productConfig.name}?`,
      answer: `${productConfig.name} brings your faith, health, planning, finances, learning, family and goals into one app, with an assistant that helps you use it. Faith is free for everyone; the other modules are part of Premium.`,
      testID: 'help-faq-what-is-noorlife',
    },
    {
      key: 'free-plan',
      question: 'What is included in the Free plan?',
      answer: `The complete Faith module — Quran, du‘a, hadith, tasbih and prayer times — plus your profile and account settings. Faith is always free and stays free, including if a Premium plan ends.`,
      testID: 'help-faq-free-plan',
    },
    {
      key: 'locked-modules',
      question: 'Why are some modules locked?',
      answer: `Premium unlocks the other ${PREMIUM_MODULE_COUNT} modules. A locked module still opens and explains what it does, so you can see what a plan includes before deciding. Nothing you have already saved is ever locked away.`,
      testID: 'help-faq-locked-modules',
    },
    {
      key: 'restore-purchases',
      question: 'How do I restore purchases?',
      answer: `Open Profile, then Family & Membership, and choose Restore Purchases. ${productConfig.name} re-checks your plan and updates your access. Use the same account you subscribed with.`,
      testID: 'help-faq-restore-purchases',
    },
    {
      key: 'noor-ai-limits',
      question: 'How is Noor AI limited?',
      answer: `On the Free plan, Noor AI answers questions about using ${productConfig.name} — finding a feature, understanding a module, moving around the app. It is not a general chatbot, it never reads a module's private data without your permission, and it does not give medical, financial or legal advice.`,
      testID: 'help-faq-noor-ai-limits',
    },
    {
      key: 'manage-profile',
      question: 'How do I manage my profile?',
      answer: `Open Profile from the home screen. Personal Information holds your name, Family & Membership holds your plan, and Preferences holds notifications, language, appearance and accessibility. Email and password changes arrive with Privacy & Security.`,
      testID: 'help-faq-manage-profile',
    },
  ];

  if (__DEV__ && options.developmentNotes) {
    entries.push({
      key: 'development-build',
      question: 'Is this a development build?',
      answer: `Yes. Purchases in this build are simulated by a development mock adapter — no payment is taken and no store subscription is created. This question does not appear in a release build.`,
      testID: 'help-faq-development-build',
    });
  }

  return entries;
}
