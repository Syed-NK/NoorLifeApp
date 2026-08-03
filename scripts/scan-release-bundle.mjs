/**
 * Scans the built Android release bundle for strings that must not ship.
 *
 * ── Why this exists as a script rather than a grep in a README ──────────────
 * Phase 6C-3A claimed `__DEV__` kept a fixture harness out of the release bundle. It did not — the
 * route's import was unconditional, so Metro compiled the harness in and only the *rendering* was
 * guarded. A grep would have disproved the claim in a second, and nobody ran one.
 *
 * ── Why a plain `grep` is not enough ────────────────────────────────────────
 * `index.android.bundle` is **Hermes bytecode**, and Hermes stores each string in the form it needs:
 * pure-ASCII strings as one byte per character, anything containing a non-ASCII character — an em
 * dash, a curly apostrophe — as UTF-16. So `grep -F 'Uninstalling removes most of it'` returns
 * nothing for a sentence that is demonstrably on the screen, and a scan that only checks one
 * encoding reports a clean bundle it never actually examined. Every needle below is checked in
 * both.
 *
 * Usage:
 *   node scripts/scan-release-bundle.mjs
 *
 * Exit code 1 if any forbidden string is present or any expected string is missing.
 */

import { Buffer } from 'node:buffer';
import { readFileSync, statSync } from 'node:fs';
import process from 'node:process';

const BUNDLE = 'android/app/build/generated/assets/react/release/index.android.bundle';

/** Must not appear. A hit is a failure. */
const FORBIDDEN = {
  'fixture harness identifiers': [
    'privacy-security-fixture',
    'PrivacySecurityFixtures',
    'Privacy & Security fixtures',
    '/profile/privacy-security/fixtures',
    'inertAccountSecurityPort',
    'test-support',
  ],
  'fixture account values': [
    'fixture.user@example.com',
    'pending.address@example.com',
    'Development only. Every fixture is local',
  ],
  'credentials and secrets': [
    'service_role',
    'SERVICE_ROLE',
    'SUPABASE_SECRET',
    'serviceRoleKey',
  ],
  'absolute claims corrected in 6C-3B': [
    'This is the complete list',
    'Removing NoorLife removes them',
    'Removing NoorLife removes everything under these',
    'This will sign you out on this and other devices.',
    'No saved AI conversation history is currently stored by NoorLife.',
  ],
  /**
   * Callback secrets, 6C-3C.
   *
   * ── Why a shipped *format string* is the thing to look for ──────────────────
   * A code or a token only exists at runtime, so no scan can find one in a bundle. What a scan *can*
   * find is the template that would print it — `code=${...}`, `url=${...}` — because Hermes keeps the
   * literal halves of a template as strings. A hit here means somebody added a log line that will
   * emit a credential on a real device, which is exactly the edit that is invisible in review.
   *
   * The three UI strings below are the other half: wording that would tell a user an email change had
   * completed while Secure Email Change still had a side outstanding.
   */
  'callback logging templates (6C-3C)': [
    '[auth-callback] url=',
    '[auth-callback] code=$',
    'access_token=',
    'refresh_token=',
    'sb_flow_id=',
    'error_description=',
  ],
  /**
   * Wording that would describe something that has not happened.
   *
   * Deliberately *not* including "Your password has been reset. Sign in with your new password." That
   * is `newPasswordCopy.done` in the locked entry-auth copy, and it is shown only after the update has
   * resolved — a true statement about a completed recovery. What makes it safe is the recovery grant
   * gate, which is asserted behaviourally by `new-password-recovery-gate.test.tsx`, not by a grep.
   *
   * The fixture shortcut is here because it was a *control* rather than a claim: it pushed Screen 11
   * directly, and Screen 11 now needs a grant, so the affordance would invite a press and refuse.
   */
  'claims and controls a callback must never ship (6C-3C)': [
    'Your email has been changed',
    'your email address has been updated',
    'I have the link — set a new password',
    'reset-sent-continue',
  ],
};

/** Must appear. An absence means the scan is looking at a stale bundle. */
const REQUIRED = [
  'In the current version of NoorLife',
  'Most device-local NoorLife data is removed when the app is uninstalled.',
  'Uninstalling removes most of it; your operating system or backup service may retain or restore some settings.',
  'This signs out this device and prevents other devices from renewing their sessions. Another device may remain active briefly.',
  'Unavailable until you enter a valid email address that is different from your current one.',
  // 6C-3C: the callback layer is actually in the bundle, and its honest states are the ones shipped.
  'Confirming your link',
  'That link has expired. Links are only good for a short while — request a new one and it will work.',
  'That link has already been used. If you still need it, request a new one.',
  'That link did not come from NoorLife, so it was not opened. If you were expecting an email from us, open the link in that message instead.',
  'We still need the confirmation sent to ',
  'A password reset has to be started from a link in your email, and each link works once. Request a new one to continue.',
  'Unavailable until you enter a new password and confirm it.',
  'Re-enter your new password to confirm it.',
];

/**
 * Present, and expected to be, until the backlog item is done.
 *
 * Reported rather than asserted. Their presence is also what proves the scan can find this class
 * of string at all — a scan that finds nothing anywhere is indistinguishable from a broken one.
 */
const KNOWN_OPEN = ['Module Gallery', 'hero-audit', 'module-gallery'];

function occurrences(data, needle) {
  const utf8 = countOf(data, Buffer.from(needle, 'utf8'));
  const utf16 = countOf(data, Buffer.from(needle, 'utf16le'));
  return { utf8, utf16, total: utf8 + utf16 };
}

function countOf(haystack, needle) {
  let count = 0;
  let at = haystack.indexOf(needle);
  while (at !== -1) {
    count += 1;
    at = haystack.indexOf(needle, at + 1);
  }
  return count;
}

let failures = 0;

try {
  statSync(BUNDLE);
} catch {
  console.error(`No release bundle at ${BUNDLE}.`);
  console.error('Build one first: cd android && ./gradlew app:assembleRelease');
  process.exit(1);
}

const data = readFileSync(BUNDLE);
const isHermes = data.subarray(8, 16).includes(0x62);
console.log(`${BUNDLE} — ${data.length} bytes${isHermes ? ' (Hermes bytecode)' : ''}\n`);

for (const [group, needles] of Object.entries(FORBIDDEN)) {
  console.log(`── must be absent: ${group}`);
  for (const needle of needles) {
    const { utf8, utf16, total } = occurrences(data, needle);
    const verdict = total === 0 ? 'absent' : `PRESENT (utf8 ${utf8}, utf16 ${utf16})`;
    if (total !== 0) {
      failures += 1;
    }
    console.log(`   ${verdict.padEnd(30)} ${needle}`);
  }
  console.log('');
}

console.log('── must be present: corrected copy');
for (const needle of REQUIRED) {
  const { utf8, utf16, total } = occurrences(data, needle);
  if (total === 0) {
    failures += 1;
  }
  const verdict = total === 0 ? 'MISSING' : `present (utf8 ${utf8}, utf16 ${utf16})`;
  console.log(`   ${verdict.padEnd(30)} ${needle.slice(0, 70)}`);
}
console.log('');

console.log('── reported only: development routes still bundled (docs/DEV_ROUTE_BACKLOG.md)');
for (const needle of KNOWN_OPEN) {
  const { total } = occurrences(data, needle);
  console.log(`   ${String(total).padStart(3)} occurrence(s)${' '.repeat(14)} ${needle}`);
}
console.log('');

if (failures > 0) {
  console.error(`FAILED — ${failures} problem(s).`);
  process.exit(1);
}
console.log('PASSED — no fixture identifier, credential or withdrawn claim in the release bundle.');
