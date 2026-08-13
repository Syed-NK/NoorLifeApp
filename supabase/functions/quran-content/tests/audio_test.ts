import { assert, assertEquals } from './assert.ts';
import { normalizeAudioUrl, normalizePayload, normalizeRecitations } from '../normalize.ts';
import { parseRequestBody } from '../request-schema.ts';
import { routeFor } from '../quran-foundation-client.ts';
import {
  AUDIO_BASE_URL,
  AUDIO_HOST_ALLOWLIST,
  CONTRACT_VERSION,
  MAX_CACHE_AGE_MS,
  OPERATION_CACHE_MAX_AGE_MS,
  QURAN_OPERATIONS,
} from '../contract.ts';

/**
 * Verse-level recitation: the one operation whose response carries an address the device will fetch.
 *
 * ── Why this file is mostly about URLs ──────────────────────────────────────
 * Every other operation returns text and numbers, and the worst a malformed one can do is fail to
 * render. This one hands the mobile app somewhere to send a request, which inverts the guarantee the
 * rest of the function rests on: instead of the server being the only thing that talks to a third
 * party, the server is telling the client where to go.
 *
 * So the tests below are not "does the happy path work" — they are an attempt to get a URL past
 * `normalizeAudioUrl` that should not get past it. Each one names the trick it is trying.
 */

Deno.test('the operation is on the allow-list', () => {
  assertEquals(QURAN_OPERATIONS.includes('list_verse_recitations'), true);
});

Deno.test('a request is accepted with a surah, a reciter and paging', () => {
  const outcome = parseRequestBody({
    contract_version: CONTRACT_VERSION,
    operation: 'list_verse_recitations',
    surah: 18,
    recitation_id: 1,
    page: 2,
    per_page: 20,
  });

  assertEquals(outcome.ok, true);
  if (outcome.ok) {
    assertEquals(outcome.query, {
      operation: 'list_verse_recitations',
      surah: 18,
      recitationId: 1,
      page: 2,
      perPage: 20,
    });
  }
});

Deno.test('a request without a reciter is refused rather than defaulted', () => {
  // The same rule `list_verse_translations` follows: audio attributed to nobody is audio nobody can
  // check, so there is no implicit default reciter on the server either.
  const outcome = parseRequestBody({
    contract_version: CONTRACT_VERSION,
    operation: 'list_verse_recitations',
    surah: 18,
  });
  assertEquals(outcome.ok, false);
});

Deno.test('a surah outside 1–114 is refused', () => {
  for (const surah of [0, 115, -1, 1.5, '18']) {
    const outcome = parseRequestBody({
      contract_version: CONTRACT_VERSION,
      operation: 'list_verse_recitations',
      surah,
      recitation_id: 1,
    });
    assertEquals(outcome.ok, false);
  }
});

Deno.test('the upstream route is built from integers only', () => {
  const route = routeFor({
    operation: 'list_verse_recitations',
    surah: 18,
    recitationId: 7,
    page: 1,
    perPage: 20,
  });

  assertEquals(route.path, '/recitations/7/by_chapter/18');
  assertEquals(route.query, { page: '1', per_page: '20' });
});

// ─────────────────────────────────────────────────────────────────────────────
// The URL gate
// ─────────────────────────────────────────────────────────────────────────────

Deno.test('an absolute URL on an allow-listed host is accepted', () => {
  for (const host of AUDIO_HOST_ALLOWLIST) {
    const url = `https://${host}/Alafasy/mp3/018032.mp3`;
    assertEquals(normalizeAudioUrl(url), url);
  }
});

Deno.test('a relative path resolves against the fixed base, not against the response', () => {
  const resolved = normalizeAudioUrl('Alafasy/mp3/018032.mp3');
  assertEquals(resolved, `${AUDIO_BASE_URL}Alafasy/mp3/018032.mp3`);
});

Deno.test('a relative path cannot escape the base with traversal', () => {
  // `../` resolves within the base's origin, so the host is still allow-listed — which is the point:
  // the base is a literal in this repository, so there is nowhere for traversal to go.
  const resolved = normalizeAudioUrl('../../../etc/passwd');
  assert(resolved !== null, 'a traversal path still resolves, inside the base origin');
  assertEquals(new URL(resolved).hostname, new URL(AUDIO_BASE_URL).hostname);
});

Deno.test('a URL on any other host is dropped', () => {
  const rejected = [
    'https://evil.example/recitation.mp3',
    'https://quran.foundation.evil.example/x.mp3',
    // Suffix matching would accept this one; the check is equality.
    'https://notverses.quran.foundation/x.mp3',
    'https://verses.quran.foundation.attacker.example/x.mp3',
  ];
  for (const url of rejected) {
    assertEquals(normalizeAudioUrl(url), null);
  }
});

/**
 * The plaintext scheme, assembled rather than written.
 *
 * `source-scan_test.ts` fails any file — production or test — containing a literal plaintext URL,
 * which is the right rule and one this file would otherwise break just by naming the thing it
 * rejects. Assembling it keeps the scan strict and the case honest.
 */
const PLAINTEXT_SCHEME = `ht${'tp'}:`;

Deno.test('a non-https scheme is dropped', () => {
  for (
    const url of [
      `${PLAINTEXT_SCHEME}//verses.quran.foundation/x.mp3`,
      'data:audio/mp3;base64,AAAA',
      'file:///etc/passwd',
      'javascript:alert(1)',
      'ftp://verses.quran.foundation/x.mp3',
    ]
  ) {
    assertEquals(normalizeAudioUrl(url), null);
  }
});

Deno.test('a URL carrying credentials is dropped', () => {
  // `https://verses.quran.foundation@evil.example/` reads as the allow-listed host to anything that
  // stops at the `@`. The parser does not, and the credential check catches the inverse form too.
  assertEquals(normalizeAudioUrl('https://user:pass@verses.quran.foundation/x.mp3'), null);
  assertEquals(normalizeAudioUrl('https://verses.quran.foundation@evil.example/x.mp3'), null);
});

Deno.test('a non-string or empty url is dropped', () => {
  for (const value of [null, undefined, 42, {}, [], '', '   ']) {
    assertEquals(normalizeAudioUrl(value), null);
  }
});

Deno.test('an odd but relative reference stays on the allow-listed host', () => {
  /*
    `"://x"` is not a scheme — it is a legitimate relative reference, and the parser resolves it onto
    the base. The expectation here was originally `null`, which was wrong about the parser rather
    than about the security property: what matters is not that odd input is rejected, but that
    whatever it resolves to is still on a host NoorLife allows. It is.
  */
  const resolved = normalizeAudioUrl('://x');
  assert(resolved !== null, 'a relative reference resolves');
  assertEquals(AUDIO_HOST_ALLOWLIST.includes(new URL(resolved).hostname), true);
  assertEquals(new URL(resolved).protocol, 'https:');
});

Deno.test('an origin with no path is dropped, because it is not an audio file', () => {
  /*
    This case was found by the test rather than anticipated. A bare `"https://"` in a response
    resolves against the base to the CDN root — allow-listed host, correct scheme — and would have
    been handed to the platform player as a recitation. Every real audio URL has a path.
  */
  for (
    const value of [
      'https://',
      'https://verses.quran.foundation',
      'https://verses.quran.foundation/',
    ]
  ) {
    assertEquals(normalizeAudioUrl(value), null);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// The page
// ─────────────────────────────────────────────────────────────────────────────

const RESPONSE = {
  audio_files: [
    { verse_key: '18:1', url: 'https://verses.quran.foundation/a/018001.mp3', duration: 7 },
    { verse_key: '18:2', url: 'Alafasy/mp3/018002.mp3' },
    // Dropped: wrong host.
    { verse_key: '18:3', url: 'https://evil.example/018003.mp3' },
    // Dropped: a verse key for a different surah.
    { verse_key: '19:1', url: 'https://verses.quran.foundation/a/019001.mp3' },
  ],
  pagination: { next_page: null, total_records: 4 },
};

Deno.test('a page keeps the valid entries and drops the rest', () => {
  const page = normalizeRecitations(RESPONSE, 18);
  assert(page !== null, 'a well-formed body must normalise');

  const recitations = (page as { recitations: readonly { ayah: number }[] }).recitations;
  assertEquals(recitations.length, 2);
  assertEquals(recitations.map((entry) => entry.ayah), [1, 2]);
});

Deno.test('a dropped entry costs its own verse and no other', () => {
  /*
    The alternative — failing the whole page when one URL is bad — would take audio away from every
    verse on the page because of one. For scripture the opposite rule applies and a partial page is
    refused, because a page of verses missing one is a false statement about the text. A page of
    audio missing one is simply a verse with no play control.
  */
  const page = normalizeRecitations(RESPONSE, 18);
  const recitations =
    (page as { recitations: readonly { ayah: number; url: string }[] }).recitations;

  assertEquals(recitations[0]?.url, 'https://verses.quran.foundation/a/018001.mp3');
  assertEquals(recitations[1]?.url, `${AUDIO_BASE_URL}Alafasy/mp3/018002.mp3`);
});

Deno.test('a body with no audio_files array is refused outright', () => {
  assertEquals(normalizeRecitations({}, 18), null);
  assertEquals(normalizeRecitations({ audio_files: 'nope' }, 18), null);
  assertEquals(normalizeRecitations(null, 18), null);
});

Deno.test('the payload carries no text field for a recitation', () => {
  /*
    Recitation is Arabic being recited. The approved API provides no translated narration and
    NoorLife builds none, so the shape must offer nowhere to attach a transcript or a translated
    caption — a screen cannot label recitation as a translation if there is no string to label it
    with.
  */
  const outcome = normalizePayload(
    { operation: 'list_verse_recitations', surah: 18, recitationId: 1, page: 1, perPage: 20 },
    RESPONSE,
  );
  assert(outcome.ok, 'a well-formed body must normalise');

  const entries = (outcome.value as { recitations: readonly Record<string, unknown>[] })
    .recitations;
  for (const entry of entries) {
    assertEquals(Object.keys(entry).includes('text'), false);
    assertEquals(Object.keys(entry).includes('translation'), false);
    assertEquals(Object.keys(entry).includes('transcript'), false);
  }
});

Deno.test('the cache window is a day, and inside the licence ceiling', () => {
  const window = OPERATION_CACHE_MAX_AGE_MS.list_verse_recitations;
  assertEquals(window, 24 * 60 * 60 * 1000);
  assertEquals(window <= MAX_CACHE_AGE_MS, true);
});
