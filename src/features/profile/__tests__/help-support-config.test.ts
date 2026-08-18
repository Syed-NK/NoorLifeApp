import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import {
  DIAGNOSTIC_FIELDS,
  formatDiagnostics,
  readAppDiagnostics,
} from '@services/diagnostics/app-diagnostics.service';
import { legalConfig, supportConfig } from '@shared/config/app-config';

import { helpFaq } from '../help-faq';

/**
 * The three promises Help & Support makes, held to one source each.
 *
 * A support address, a policy URL and a diagnostic payload are the parts of this feature that
 * survive contact with the outside world: a user emails the address, a store reviewer opens the
 * URL, and whatever the payload contains ends up in a mailbox. Each one is therefore asserted
 * against its single definition rather than against the screen that renders it.
 */

const SRC_ROOT = join(__dirname, '..', '..', '..');
const CONFIG_FILE = join(SRC_ROOT, 'shared', 'config', 'app-config.ts');

function sourceFiles(directory: string): readonly string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      return entry === '__tests__' ? [] : sourceFiles(path);
    }
    return entry.endsWith('.ts') || entry.endsWith('.tsx') ? [path] : [];
  });
}

describe('the centralized configuration', () => {
  it('records the exact support address', () => {
    expect(supportConfig.email).toBe('hello@nkdigitalworks.com');
  });

  it('records the exact legal and website URLs', () => {
    expect(legalConfig.privacyPolicy).toBe('https://nkdigitalworks.com/privacy');
    expect(legalConfig.termsOfService).toBe('https://nkdigitalworks.com/terms');
    expect(supportConfig.website).toBe('https://nkdigitalworks.com');
  });

  it.each([
    ['the support address', 'hello@nkdigitalworks.com'],
    ['the Privacy Policy URL', 'https://nkdigitalworks.com/privacy'],
    ['the Terms of Service URL', 'https://nkdigitalworks.com/terms'],
  ])('is the only place in the source that writes out %s', (_name, literal) => {
    // A second copy is the one that does not get updated when the mailbox or the domain moves.
    const offenders = sourceFiles(SRC_ROOT)
      .filter((file) => file !== CONFIG_FILE)
      .filter((file) => readFileSync(file, 'utf8').includes(literal))
      .map((file) => file.replace(SRC_ROOT, ''));

    expect(offenders).toEqual([]);
  });
});

describe('the diagnostic payload', () => {
  it('has exactly four fields', () => {
    expect([...DIAGNOSTIC_FIELDS]).toEqual(['appVersion', 'buildNumber', 'platform', 'osVersion']);
  });

  it('reads the version and build from the installed package', () => {
    const diagnostics = readAppDiagnostics();

    // Stood in at the values the current Android build declares. What matters is that they come
    // from `expo-application` rather than from a constant somebody has to remember to bump.
    expect(diagnostics.appVersion).toBe('1.0.0');
    expect(diagnostics.buildNumber).toBe('1');
    expect(diagnostics.platform).toBeTruthy();
  });

  it('reports the OS release rather than the Android API level', () => {
    // The device pass caught "Android 37" under a label reading OS version — 37 is the API level
    // for Android 17, which is the wrong number to show a user.
    expect(readAppDiagnostics().osVersion).toBe('17');
  });

  it('formats one line per allowed field and nothing else', () => {
    const report = formatDiagnostics(readAppDiagnostics());

    expect(report.split('\n')).toHaveLength(DIAGNOSTIC_FIELDS.length);
    for (const label of ['App version', 'Build', 'Platform', 'OS version']) {
      expect(report).toContain(label);
    }
  });

  it('cannot carry credentials, identity or module data', () => {
    const report = formatDiagnostics({
      appVersion: '1.0.0',
      buildNumber: '1',
      platform: 'Android',
      osVersion: '16',
    }).toLowerCase();

    // Not a redaction pass — the type has four fields, so there is no path by which any of these
    // could reach a report. This asserts the consequence.
    for (const forbidden of [
      'token',
      'supabase',
      'password',
      'session',
      'email',
      'quran',
      'health',
      'finance',
      'family',
      'conversation',
      'device id',
      'androidid',
    ]) {
      expect(report).not.toContain(forbidden);
    }
  });
});

describe('the production Help copy', () => {
  const production = helpFaq({ developmentNotes: false });

  it('answers the six questions the brief names, and no more', () => {
    expect(production.map((entry) => entry.key)).toEqual([
      'what-is-noorlife',
      'free-plan',
      'locked-modules',
      'restore-purchases',
      'noor-ai-limits',
      'manage-profile',
    ]);
  });

  it.each(['mock', 'simulated', 'no payment', 'development build', '__dev__'])(
    'never mentions %s',
    (word) => {
      // Purchases run through a development mock adapter. That is a true thing for a tester and an
      // alarming thing for a user, so it is not built into the production list at all.
      const text = production
        .map((entry) => `${entry.question} ${entry.answer}`)
        .join(' ')
        .toLowerCase();
      expect(text).not.toContain(word);
    },
  );

  it('adds the development answer only when the flag is set', () => {
    const development = helpFaq({ developmentNotes: true });

    expect(development).toHaveLength(production.length + 1);
    expect(development.at(-1)?.key).toBe('development-build');
    expect(development.at(-1)?.answer.toLowerCase()).toContain('simulated');
  });

  it('keeps Faith free and Noor AI bounded in the answers themselves', () => {
    const answers = Object.fromEntries(production.map((entry) => [entry.key, entry.answer]));

    expect(answers['free-plan']).toContain('Faith is always free');
    expect(answers['locked-modules']).toContain('Premium unlocks the other 6 modules');
    expect(answers['noor-ai-limits']).toContain('not a general chatbot');
    expect(answers['noor-ai-limits']).toContain('medical, financial or legal advice');
  });
});
