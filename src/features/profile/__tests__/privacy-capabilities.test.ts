import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { DIAGNOSTIC_FIELDS, formatDiagnostics } from '@services/diagnostics/app-diagnostics.service';
import { legalConfig } from '@shared/config/app-config';

import {
  ACCOUNT_HELD_DATA,
  DEVICE_STORAGE_NAMESPACES,
  PRIVACY_CAPABILITIES,
  TELEMETRY_PACKAGE_MARKERS,
  TELEMETRY_SDKS_INSTALLED,
} from '../privacy/privacy-capabilities';
import { privacySecurityCopy } from '../privacy-security-copy';

/**
 * The privacy audit, checked against the repository rather than against itself.
 *
 * "We collect no analytics" is the kind of claim that is true when it is written and quietly false
 * two dependencies later. So the constant the screen renders is verified here against
 * `package.json` and against the source tree — a telemetry SDK appearing in the project fails this
 * suite before the screen can go on saying otherwise.
 */

const REPO_ROOT = join(__dirname, '..', '..', '..', '..');
const SRC_ROOT = join(REPO_ROOT, 'src');

function sourceFiles(directory: string): readonly string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      return entry === '__tests__' ? [] : sourceFiles(path);
    }
    return entry.endsWith('.ts') || entry.endsWith('.tsx') ? [path] : [];
  });
}

describe('the telemetry audit', () => {
  const manifest = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as {
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
  };
  const installed = [
    ...Object.keys(manifest.dependencies),
    ...Object.keys(manifest.devDependencies),
  ];

  it('finds no analytics or crash-reporting dependency installed', () => {
    const offenders = installed.filter((name) =>
      TELEMETRY_PACKAGE_MARKERS.some((marker) => name.includes(marker)),
    );
    expect(offenders).toEqual([]);
  });

  it('agrees with the constant the screen renders', () => {
    // If the assertion above ever fails, this one holds the screen honest: the claim and the
    // installed dependencies are the same fact stated twice, and they must not diverge.
    const anyInstalled = installed.some((name) =>
      TELEMETRY_PACKAGE_MARKERS.some((marker) => name.includes(marker)),
    );
    expect(TELEMETRY_SDKS_INSTALLED).toBe(anyInstalled);
  });

  it('finds no telemetry initialisation anywhere in the source', () => {
    // A dependency is the usual route in, but a hand-rolled beacon would not appear in
    // `package.json` at all. These are the calls one would take.
    const offenders = sourceFiles(SRC_ROOT).filter((file) => {
      const source = readFileSync(file, 'utf8');
      return (
        /\bSentry\s*\.\s*init\b/.test(source) ||
        /\banalytics\s*\.\s*(track|logEvent|identify)\b/.test(source) ||
        /\blogEvent\s*\(/.test(source) ||
        /\bnavigator\s*\.\s*sendBeacon\b/.test(source)
      );
    });
    expect(offenders).toEqual([]);
  });
});

describe('the declared capabilities', () => {
  it('covers the five categories the brief names', () => {
    expect(PRIVACY_CAPABILITIES.map((capability) => capability.key)).toEqual([
      'product-analytics',
      'crash-reporting',
      'diagnostics',
      'personalization',
      'local-data',
    ]);
  });

  it.each([
    ['product-analytics'],
    ['crash-reporting'],
    ['personalization'],
  ])('reports %s as not collected, because it is not', (key) => {
    const capability = PRIVACY_CAPABILITIES.find((entry) => entry.key === key);
    expect(capability?.status).toBe('not-collected');
    expect(capability?.scope).toBe('none');
  });

  it('keeps diagnostics opt-in at the moment of use', () => {
    const diagnostics = PRIVACY_CAPABILITIES.find((entry) => entry.key === 'diagnostics');
    // Not a background collection with a switch — nothing is gathered until a press sends it.
    expect(diagnostics?.status).toBe('opt-in-at-use');
    expect(diagnostics?.scope).toBe('device');
    expect(diagnostics?.detail).toContain('Nothing is sent unless you press');
  });

  it('describes the diagnostic payload with the number of fields it actually has', () => {
    const diagnostics = PRIVACY_CAPABILITIES.find((entry) => entry.key === 'diagnostics');
    expect(diagnostics?.detail).toContain(`${DIAGNOSTIC_FIELDS.length} build facts`);
  });

  it('names each category as device-local or account-level', () => {
    for (const capability of PRIVACY_CAPABILITIES) {
      expect(['device', 'account', 'none']).toContain(capability.scope);
    }
    // At least one of each of the two that mean something, so the distinction is actually drawn.
    expect(PRIVACY_CAPABILITIES.some((entry) => entry.scope === 'device')).toBe(true);
    expect(ACCOUNT_HELD_DATA.length).toBeGreaterThan(0);
  });
});

describe('what a diagnostic report can carry', () => {
  it('excludes every sensitive module and every credential', () => {
    const report = formatDiagnostics({
      appVersion: '1.0.0',
      buildNumber: '1',
      platform: 'Android',
      osVersion: '17',
    }).toLowerCase();

    for (const forbidden of [
      'faith',
      'quran',
      'health',
      'finance',
      'family',
      'goal',
      'conversation',
      'password',
      'token',
      'session',
      'email',
    ]) {
      expect(report).not.toContain(forbidden);
    }
  });

  it('says so on the screen as well, so the user does not have to take it on trust', () => {
    const sentence = privacySecurityCopy.privacy.diagnosticsExclusion;
    for (const subject of [
      'Faith',
      'Quran',
      'health',
      'finance',
      'family',
      'goal',
      'AI conversations',
      'password',
      'sign-in tokens',
    ]) {
      expect(sentence).toContain(subject);
    }
  });
});

describe('the storage inventory', () => {
  it('covers every namespace the source actually writes', () => {
    const found = new Set<string>();
    for (const file of sourceFiles(SRC_ROOT)) {
      for (const match of readFileSync(file, 'utf8').matchAll(/['"`]noorlife\.([a-zA-Z]+)/g)) {
        found.add(`noorlife.${match[1] as string}`);
      }
    }
    // A new namespace fails here rather than quietly appearing on a device while the screen still
    // lists four.
    expect([...found].sort()).toEqual([...DEVICE_STORAGE_NAMESPACES].sort());
  });
});

describe('the privacy policy link', () => {
  it('is the centralized URL, exactly', () => {
    expect(privacySecurityCopy.privacy.privacyPolicyUrl).toBe(legalConfig.privacyPolicy);
  });

  it('is not written out a second time anywhere in this feature', () => {
    // `help-support-config.test.ts` asserts this repository-wide; this narrows it to the files
    // added by this phase, so the failure names the right place.
    const offenders = sourceFiles(join(SRC_ROOT, 'features', 'profile'))
      .filter((file) => readFileSync(file, 'utf8').includes(legalConfig.privacyPolicy))
      .map((file) => file.replace(SRC_ROOT, ''));
    expect(offenders).toEqual([]);
  });
});

describe('the encryption claim', () => {
  it('never says end-to-end without denying it', () => {
    const note = privacySecurityCopy.privacy.encryptionNote;
    expect(note).toContain('not end-to-end encrypted');
  });

  it('is the only place on the screen that mentions encryption at all', () => {
    const copyText = JSON.stringify(privacySecurityCopy).toLowerCase();
    const mentions = copyText.split('end-to-end').length - 1;
    // One mention, and it is the denial. A second would be a claim somebody added elsewhere.
    expect(mentions).toBe(1);
  });
});

/**
 * The absolute claims, checked over *every* string this screen can render.
 *
 * The 6C-3B device pass is the reason this scan exists rather than a check on one field.
 * `privacySecurityCopy.privacy.storageSupporting` was corrected, the emulator was opened, and two
 * paragraphs above the corrected sentence the Local application data row still read "Removing
 * NoorLife removes them." — the same promise, in a string that lives in this file rather than the
 * copy file, which the first audit did not reach.
 *
 * So the assertion is over the union of both sources. A third home for a privacy sentence would
 * have to be added to `ALL_RENDERED_PRIVACY_TEXT` to escape it, which is a visible edit rather than
 * an oversight.
 */
describe('claims the screen may not make', () => {
  const ALL_RENDERED_PRIVACY_TEXT = [
    JSON.stringify(privacySecurityCopy.privacy),
    JSON.stringify(privacySecurityCopy.ai),
    ...PRIVACY_CAPABILITIES.map((capability) => `${capability.label} ${capability.detail}`),
    ...ACCOUNT_HELD_DATA,
  ]
    .join(' ')
    .toLowerCase();

  it.each([
    // Uninstall is the operating system's behaviour, not this application's. Android declares
    // `allowBackup="true"`, and iOS keeps Keychain items in a restorable class.
    'removing noorlife removes them',
    'removing noorlife removes everything',
    'uninstalling removes everything',
    'uninstalling deletes everything',
    'deleting the app deletes everything',
    'nothing is left on your device',
    'is completely removed',
    // Completeness is a claim about builds that do not exist yet.
    'this is the complete list',
    'the complete list',
    'the full list of everything',
  ])('never says "%s"', (phrase) => {
    expect(ALL_RENDERED_PRIVACY_TEXT).not.toContain(phrase);
  });

  it('qualifies every uninstall sentence it does make', () => {
    const uninstallSentences = [
      privacySecurityCopy.privacy.storageSupporting,
      ...PRIVACY_CAPABILITIES.map((capability) => capability.detail),
    ].filter((text) => /uninstall|removing noorlife/i.test(text));

    // At least one such sentence exists — otherwise this test would pass by saying nothing.
    expect(uninstallSentences.length).toBeGreaterThan(0);
    for (const sentence of uninstallSentences) {
      expect(sentence.toLowerCase()).toMatch(/operating system|backup service/);
    }
  });
});
