import fs from 'node:fs';
import path from 'node:path';

import { createMlKitReceiptOcr } from '../receipts/mlkit-receipt-ocr';
import {
  MAX_RECEIPT_LINES,
  MAX_RECEIPT_LINE_LENGTH,
  isLocalImageUri,
  normaliseRecognisedText,
} from '../receipts/receipt-ocr.port';

/**
 * **The boundary between Finance and a native text recogniser** — issue #101.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Why the vendor module is replaced rather than loaded ───────────────────
 * `@react-native-ml-kit/text-recognition` ships TypeScript source as its entry point and is not in
 * this project's `transformIgnorePatterns` allow-list, so requiring it under Jest would fail before
 * any assertion ran. A factory mock is not a convenience here — it is the only way the adapter's own
 * logic can be tested at all, and it has the useful side effect that these cases prove what the
 * adapter does with a *stated* native response rather than with whatever a real one happened to be.
 *
 * ── What is actually being protected ───────────────────────────────────────
 * Three properties, and none of them is about text recognition working. That the recogniser is
 * handed a local file and never a URL; that a native result which is not the shape the vendor
 * documents becomes a *failure* rather than a crash or an empty receipt; and that nothing behind
 * this port can reach a network, a log or a backend. The third is asserted from the source, because
 * it is a property of what the files import rather than of what they do when called.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const mockRecognize = jest.fn();

jest.mock('@react-native-ml-kit/text-recognition', () => ({
  __esModule: true,
  default: { recognize: (...args: unknown[]) => mockRecognize(...args) },
  TextRecognitionScript: {
    LATIN: 'Latin',
    CHINESE: 'Chinese',
    DEVANAGARI: 'Devanagari',
    JAPANESE: 'Japanese',
    KOREAN: 'Korean',
  },
}));

const LOCAL = 'file:///cache/finance-receipts/staging/abc.jpg';

const RECEIPTS_DIR = path.join(process.cwd(), 'src', 'features', 'finance', 'receipts');
const SCREEN = path.join(
  process.cwd(),
  'src',
  'features',
  'finance',
  'screens',
  'finance-receipts-screen.tsx',
);

function workflowSources(): readonly { readonly name: string; readonly text: string }[] {
  const files = fs
    .readdirSync(RECEIPTS_DIR)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => ({ name, text: fs.readFileSync(path.join(RECEIPTS_DIR, name), 'utf8') }));
  return [...files, { name: 'finance-receipts-screen.tsx', text: fs.readFileSync(SCREEN, 'utf8') }];
}

/** Source with comments removed, so a rule is not "passed" by a sentence describing it. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

beforeEach(() => {
  mockRecognize.mockReset();
});

// ─────────────────────────────────────────────────────────────────────────────
// The native call
// ─────────────────────────────────────────────────────────────────────────────

describe('the adapter calls the recogniser with a local uri and the Latin script', () => {
  it('passes the file uri through and asks for Latin', async () => {
    mockRecognize.mockResolvedValue({ text: 'TOTAL 12.34' });

    const outcome = await createMlKitReceiptOcr().recognise({ uri: LOCAL });

    expect(mockRecognize).toHaveBeenCalledTimes(1);
    expect(mockRecognize).toHaveBeenCalledWith(LOCAL, 'Latin');
    expect(outcome).toEqual({ kind: 'recognised', lines: ['TOTAL 12.34'] });
  });

  it('never calls the recogniser for a remote url', async () => {
    const outcome = await createMlKitReceiptOcr().recognise({
      uri: 'https://example.test/receipt.jpg',
    });

    /*
      The vendor's `recognize` would happily fetch this. A workflow that promises the image never
      leaves the device must not have a path that pulls one *onto* it either, and refusing before the
      call is what makes that true rather than merely intended.
    */
    expect(mockRecognize).not.toHaveBeenCalled();
    expect(outcome).toEqual({ kind: 'failed', reason: 'unavailable' });
  });

  it.each([
    ['a content uri', 'content://media/external/images/1'],
    ['a bare path', '/data/user/0/app/cache/x.jpg'],
    ['an empty string', ''],
    ['a data url', 'data:image/jpeg;base64,AAAA'],
  ])('refuses %s without calling the recogniser', async (_label, uri) => {
    const outcome = await createMlKitReceiptOcr().recognise({ uri });

    expect(mockRecognize).not.toHaveBeenCalled();
    expect(outcome).toEqual({ kind: 'failed', reason: 'unavailable' });
  });

  it('reports a recogniser that throws as unreadable, and lets nothing escape', async () => {
    mockRecognize.mockRejectedValue(new Error(`could not decode ${LOCAL}: MERCHANT LTD`));

    const outcome = await createMlKitReceiptOcr().recognise({ uri: LOCAL });

    expect(outcome).toEqual({ kind: 'failed', reason: 'unreadable' });
    /* The vendor's message is not carried out of the adapter in any form. */
    expect(JSON.stringify(outcome)).not.toContain('MERCHANT');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Results that are not a receipt
// ─────────────────────────────────────────────────────────────────────────────

describe('the four outcomes are distinguished', () => {
  it('reports an image with no text as empty rather than failed', async () => {
    mockRecognize.mockResolvedValue({ text: '' });

    /*
      A photograph of a wall is not an error. Reporting it as one would offer a retry for something
      retrying cannot fix, and hide the one thing worth saying: nothing was readable in this picture.
    */
    expect(await createMlKitReceiptOcr().recognise({ uri: LOCAL })).toEqual({ kind: 'empty' });
  });

  it('reports whitespace-only text as empty', async () => {
    mockRecognize.mockResolvedValue({ text: '   \n\n  \t \n' });

    expect(await createMlKitReceiptOcr().recognise({ uri: LOCAL })).toEqual({ kind: 'empty' });
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'TOTAL 12.34'],
    ['an array', []],
    ['an object with no text', { blocks: [] }],
    ['an object whose text is a number', { text: 12.34 }],
    ['an object whose text is null', { text: null }],
  ])('reports %s as a failure rather than an empty receipt', async (_label, value) => {
    mockRecognize.mockResolvedValue(value);

    /*
      The distinction matters on screen. "Nothing was readable" invites a retake; "this could not be
      read on this device" does not. Collapsing a malformed native payload into `empty` would tell
      the user their photograph was bad when the recogniser was.
    */
    expect(await createMlKitReceiptOcr().recognise({ uri: LOCAL })).toEqual({
      kind: 'failed',
      reason: 'unreadable',
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Abort
// ─────────────────────────────────────────────────────────────────────────────

describe('a withdrawn request', () => {
  it('never calls the recogniser when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    const outcome = await createMlKitReceiptOcr().recognise({
      uri: LOCAL,
      signal: controller.signal,
    });

    expect(mockRecognize).not.toHaveBeenCalled();
    expect(outcome).toEqual({ kind: 'failed', reason: 'aborted' });
  });

  it('drops a result that arrives after the request was withdrawn', async () => {
    const controller = new AbortController();
    mockRecognize.mockImplementation(async () => {
      /* Aborted while the native side is working — the unmount and replace case. */
      controller.abort();
      return { text: 'TOTAL 84.20' };
    });

    const outcome = await createMlKitReceiptOcr().recognise({
      uri: LOCAL,
      signal: controller.signal,
    });

    expect(outcome).toEqual({ kind: 'failed', reason: 'aborted' });
    expect(JSON.stringify(outcome)).not.toContain('84.20');
  });

  it('reports an abort rather than a failure when a withdrawn call also rejects', async () => {
    const controller = new AbortController();
    mockRecognize.mockImplementation(async () => {
      controller.abort();
      throw new Error('cancelled');
    });

    expect(
      await createMlKitReceiptOcr().recognise({ uri: LOCAL, signal: controller.signal }),
    ).toEqual({ kind: 'failed', reason: 'aborted' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The narrow result
// ─────────────────────────────────────────────────────────────────────────────

describe('the port returns lines and nothing else', () => {
  it('drops the vendor geometry, confidence and language fields entirely', async () => {
    mockRecognize.mockResolvedValue({
      text: 'MERCHANT\nTOTAL 12.34',
      blocks: [
        {
          text: 'MERCHANT',
          frame: { width: 100, height: 20, top: 4, left: 8 },
          cornerPoints: [{ x: 0, y: 0 }],
          mockRecognizedLanguages: [{ languageCode: 'en' }],
          lines: [{ text: 'MERCHANT', elements: [{ text: 'MERCHANT' }] }],
        },
      ],
    });

    const outcome = await createMlKitReceiptOcr().recognise({ uri: LOCAL });

    /*
      Asserted as an exact object rather than by checking a few keys. "There is no geometry" is a
      statement about the whole result, and `toEqual` on the whole result is the only assertion that
      makes it.
    */
    expect(outcome).toEqual({ kind: 'recognised', lines: ['MERCHANT', 'TOTAL 12.34'] });
  });

  it('trims each line and drops blank ones', () => {
    expect(normaliseRecognisedText({ text: '  A  \n\n \n B ' })).toEqual(['A', 'B']);
  });

  it('drops a line longer than the bound rather than truncating it', () => {
    const long = 'x'.repeat(MAX_RECEIPT_LINE_LENGTH + 1);

    /*
      Dropped, not cut. A truncated line is a line that reads as complete and is not, and the parser
      would then look for a total inside half a string.
    */
    expect(normaliseRecognisedText({ text: `KEEP\n${long}` })).toEqual(['KEEP']);
  });

  it('keeps a line exactly at the bound', () => {
    const exact = 'x'.repeat(MAX_RECEIPT_LINE_LENGTH);

    expect(normaliseRecognisedText({ text: exact })).toEqual([exact]);
  });

  it('caps how many lines a receipt may contribute', () => {
    const many = Array.from({ length: MAX_RECEIPT_LINES + 50 }, (_, index) => `L${index}`);

    expect(normaliseRecognisedText({ text: many.join('\n') })).toHaveLength(MAX_RECEIPT_LINES);
  });

  it('handles carriage returns, which a decoder may produce', () => {
    expect(normaliseRecognisedText({ text: 'A\r\nB' })).toEqual(['A', 'B']);
  });
});

describe('isLocalImageUri', () => {
  it.each([
    ['file:///cache/x.jpg', true],
    ['  file:///cache/x.jpg  ', true],
    ['file://host/x.jpg', false],
    ['https://x.test/a.jpg', false],
    ['content://media/1', false],
    ['', false],
  ])('reads %s as %s', (uri, expected) => {
    expect(isLocalImageUri(uri)).toBe(expected);
  });

  it.each([[null], [undefined], [42], [{}]])('refuses the non-string %p', (value) => {
    expect(isLocalImageUri(value)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// What the workflow may not import or say
// ─────────────────────────────────────────────────────────────────────────────

describe('nothing in the receipt workflow can reach a network, a log or a backend', () => {
  it('imports no client, no backend and no analytics anywhere in the workflow', () => {
    for (const { name, text } of workflowSources()) {
      const source = stripComments(text);
      const imports = [...source.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1] ?? '');

      for (const specifier of imports) {
        expect([name, specifier]).not.toEqual([
          name,
          expect.stringMatching(/supabase|analytics|sentry|amplitude|posthog|firebase|axios/i),
        ]);
      }
      /* Not only imports: a global `fetch` needs no import at all. */
      expect([name, source]).not.toEqual([name, expect.stringMatching(/\bfetch\s*\(/)]);
      expect([name, source]).not.toEqual([name, expect.stringMatching(/\bXMLHttpRequest\b/)]);
      expect([name, source]).not.toEqual([name, expect.stringMatching(/\bWebSocket\b/)]);
      expect([name, source]).not.toEqual([
        name,
        expect.stringMatching(/\bnavigator\.sendBeacon\b/),
      ]);
    }
  });

  it('logs nothing at all from the receipt workflow', () => {
    for (const { name, text } of workflowSources()) {
      /*
        Not "logs no receipt content" — logs nothing. A rule about *which* values may be logged is a
        rule somebody has to apply correctly at every call site; a rule that there are no call sites
        is one a scan can keep. The recognised text is in scope in several of these files, so the
        cheap mistake is one `console.log` during debugging that survives review.
      */
      expect([name, stripComments(text)]).not.toEqual([
        name,
        expect.stringMatching(/console\.\w+\s*\(/),
      ]);
    }
  });

  it('imports the vendor recogniser in exactly one file', () => {
    const importing = workflowSources().filter(({ text }) =>
      stripComments(text).includes('@react-native-ml-kit/text-recognition'),
    );

    expect(importing.map(({ name }) => name)).toEqual(['mlkit-receipt-ocr.ts']);
  });

  it('imports the image picker in no feature file at all', () => {
    /*
      `expo-receipt-source.ts` is the adapter and is expected to. What must not happen is a *screen*
      or a *parser* reaching for the picker directly, because that is how a permission prompt escapes
      the one press it is supposed to be tied to.
    */
    const importing = workflowSources().filter(({ text }) =>
      stripComments(text).includes("from 'expo-image-picker'"),
    );

    expect(importing.map(({ name }) => name)).toEqual(['expo-receipt-source.ts']);
  });

  it('asks the recogniser for the Latin script and no other', () => {
    const adapter = stripComments(
      fs.readFileSync(path.join(RECEIPTS_DIR, 'mlkit-receipt-ocr.ts'), 'utf8'),
    );

    expect(adapter).toContain('TextRecognitionScript.LATIN');
    for (const script of ['CHINESE', 'DEVANAGARI', 'JAPANESE', 'KOREAN']) {
      expect(adapter).not.toContain(`TextRecognitionScript.${script}`);
    }
  });
});
