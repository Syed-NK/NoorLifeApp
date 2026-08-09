import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';

import {
  NOOR_AI_DRAFT_MAX_CODE_POINTS,
  evaluateNoorAIDraft,
} from '../noor-ai/noor-ai-message-draft';

/**
 * What the Noor AI interface must not be able to do.
 *
 * ── Why a source scan rather than more render tests ─────────────────────────
 * `noor-ai-chat-screen.test.tsx` drives the surface and proves what it does. Every rule below is
 * about the *absence* of something, and a behavioural test can only show that a path it thought to
 * exercise did not do it. "No Noor AI screen persists a prompt" is not provable by pressing
 * buttons — it is provable by reading every file in the feature and finding no persistence API.
 * That is the same instrument `privacy-security-source-scan.test.ts` and
 * `noor-ai-adapter-guards.test.ts` use, and it catches the future edit a runtime test would never
 * see.
 *
 * Comments are stripped before every assertion about code, because a file that documents "this must
 * never call a provider endpoint" contains that endpoint's name, and a guard matching it would fail
 * for the wrong reason.
 */

const SRC_ROOT = join(__dirname, '..', '..', '..');
const REPO_ROOT = join(SRC_ROOT, '..');
const NOOR_AI_FEATURE = join(SRC_ROOT, 'features', 'modules', 'noor-ai');
const AI_ROUTES = join(SRC_ROOT, 'app', 'ai');
const ADAPTER = join(SRC_ROOT, 'services', 'ai', 'noor-ai.service.ts');
const FUNCTION_DIR = join(REPO_ROOT, 'supabase', 'functions', 'noor-ai');

function sourceFiles(directory: string): readonly string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      return entry === '__tests__' ? [] : sourceFiles(path);
    }
    return entry.endsWith('.ts') || entry.endsWith('.tsx') ? [path] : [];
  });
}

/** Removes block and line comments, so every assertion is about executable text. */
function strip(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function relative(file: string): string {
  return file.replace(SRC_ROOT, '');
}

/** Everything this phase ships into the application bundle for Noor AI's surface. */
const UI_FILES = [...sourceFiles(NOOR_AI_FEATURE), ...sourceFiles(AI_ROUTES)];
const UI_SOURCE = UI_FILES.map((path) => ({
  path: relative(path),
  code: strip(readFileSync(path, 'utf8')),
}));

describe('the Noor AI interface reaches nothing it must not', () => {
  it('scans a non-empty set of files', () => {
    // A guard: an empty list would satisfy every assertion below and prove nothing.
    expect(UI_SOURCE.length).toBeGreaterThanOrEqual(8);
    expect(UI_SOURCE.map((file) => file.path)).toContain(
      `${sep}features${sep}modules${sep}noor-ai${sep}noor-ai-chat-screen.tsx`,
    );
    expect(UI_SOURCE.map((file) => file.path)).toContain(
      `${sep}app${sep}ai${sep}chat${sep}[conversationId].tsx`,
    );
  });

  it('imports no Supabase client and constructs none', () => {
    for (const { path, code } of UI_SOURCE) {
      expect({
        path,
        matched: /@\/lib\/supabase|@supabase\/supabase-js|createClient\s*\(/.test(code),
      }).toEqual({ path, matched: false });
    }
  });

  it('invokes no Edge Function and opens no connection of its own', () => {
    for (const { path, code } of UI_SOURCE) {
      expect({
        path,
        matched:
          /functions\s*\.\s*invoke|\.invoke\s*\(|\bfetch\s*\(|XMLHttpRequest|WebSocket|new\s+URL\s*\(|https?:\/\//.test(
            code,
          ),
      }).toEqual({ path, matched: false });
    }
  });

  it('names no provider, key, endpoint, project reference or privileged role', () => {
    for (const { path, code } of UI_SOURCE) {
      expect({
        path,
        matched:
          /service_role|serviceRole|SERVICE_ROLE|SUPABASE_SECRET|OPENAI_API_KEY|api\.openai\.com|\/v1\/responses|from\s+['"](npm:)?openai|@ai-sdk|langchain|sb_secret_|sbp_/i.test(
            code,
          ),
      }).toEqual({ path, matched: false });
    }
  });

  it('embeds no credential-shaped literal, comments included', () => {
    for (const path of UI_FILES) {
      const raw = readFileSync(path, 'utf8');
      expect(raw).not.toMatch(/sb_secret_[A-Za-z0-9]{20,}|sbp_[A-Za-z0-9]{20,}/);
      expect(raw).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/);
      expect(raw).not.toMatch(/-----BEGIN [A-Z ]*PRIVATE KEY-----/);
    }
  });

  it('reaches no quota store, RPC or database identifier', () => {
    for (const { path, code } of UI_SOURCE) {
      expect({
        path,
        matched: /\brpc\s*\(|noor_ai_reserve|noor_ai_finalize|noor_ai_status|\.from\s*\(/.test(
          code,
        ),
      }).toEqual({ path, matched: false });
    }
  });

  it('reads no module data', () => {
    // The repository seam every module's records come through, and the mock behind it.
    for (const { path, code } of UI_SOURCE) {
      expect({
        path,
        matched:
          /ModuleRepository|useModuleOverview|useFaithRepositories|module-data\.contract/.test(
            code,
          ),
      }).toEqual({ path, matched: false });
    }
  });
});

describe('one invocation, guaranteed structurally', () => {
  const screenCode = strip(readFileSync(join(NOOR_AI_FEATURE, 'noor-ai-chat-screen.tsx'), 'utf8'));

  it('reaches the port from exactly one place', () => {
    /**
     * The structural half of `NOOR_AI_ONE_INVOCATION_INVARIANT`, applied to the caller.
     *
     * A rendered test can show that the presses it made produced one call. It cannot show there is
     * only one place a call could come from — a second `port.ask` added to an effect, a chip
     * handler or a retry would be invisible to it until somebody thought to press that thing.
     */
    const callSites = screenCode.match(/port\s*\.\s*ask\s*\(/g) ?? [];
    expect(callSites).toHaveLength(1);
  });

  it('checks the synchronous in-flight guard before it reaches the port', () => {
    // Two presses inside one frame both run before React redraws the disabled control, so the
    // guard that stops the second one has to be a ref rather than the `pending` state.
    expect(screenCode).toMatch(/const inFlight = useRef\(false\)/);
    const guardAt = screenCode.indexOf('if (inFlight.current)');
    const askAt = screenCode.indexOf('port.ask(');
    expect(guardAt).toBeGreaterThan(-1);
    expect(askAt).toBeGreaterThan(guardAt);
    expect(screenCode).toMatch(/inFlight\.current = true/);
  });

  it('wraps that call in no loop, no timer and no retry construct', () => {
    expect(screenCode).not.toMatch(/\bwhile\s*\(/);
    expect(screenCode).not.toMatch(/\bdo\s*\{/);
    expect(screenCode).not.toMatch(/\bfor\s*\(/);
    expect(screenCode).not.toMatch(/setTimeout|setInterval|requestAnimationFrame/);
    expect(screenCode).not.toMatch(/\bretry|\bbackoff|\battempt\s*[0-9+]/i);
  });

  it('runs no request from an effect, so mounting the screen asks nothing', () => {
    // The only effect on the screen is the mount/unmount bookkeeping for the abort controller.
    const effects = screenCode.match(/useEffect\(/g) ?? [];
    expect(effects).toHaveLength(1);
    const effectBody = screenCode.slice(screenCode.indexOf('useEffect('));
    expect(effectBody.slice(0, effectBody.indexOf('}, [])')).includes('port.ask')).toBe(false);
  });
});

describe('the Noor AI interface keeps nothing', () => {
  it('writes to no storage of any kind', () => {
    for (const { path, code } of UI_SOURCE) {
      expect({
        path,
        matched:
          /AsyncStorage|SecureStore|expo-secure-store|MMKV|localStorage|sessionStorage|createJSONStorage|persistReducer|\.insert\s*\(|\.upsert\s*\(/.test(
            code,
          ),
      }).toEqual({ path, matched: false });
    }
  });

  it('logs nothing, and adds no analytics or telemetry', () => {
    for (const { path, code } of UI_SOURCE) {
      expect({ path, matched: /console\s*\.\s*[a-z]+\s*\(/.test(code) }).toEqual({
        path,
        matched: false,
      });
      expect({
        path,
        matched:
          /analytics|telemetry|\btrack\s*\(|captureException|Sentry|reportError|amplitude|mixpanel/i.test(
            code,
          ),
      }).toEqual({ path, matched: false });
    }
  });

  it('introduces no conversation store and no history state', () => {
    for (const { path, code } of UI_SOURCE) {
      expect({
        path,
        matched: /conversationStore|conversationHistory|saveConversation|messages\s*:/.test(code),
      }).toEqual({ path, matched: false });
    }
  });
});

describe('the fixture mechanism cannot be selected in production', () => {
  it('is not imported by any application module', () => {
    // A single `@/test-support/…` import from `app` or `features` would put the fixtures straight
    // back into the bundle, and would do it silently.
    for (const { path, code } of UI_SOURCE) {
      expect({ path, matched: code.includes('test-support') }).toEqual({ path, matched: false });
    }
  });

  it('has no route, and no file named for it under app or features', () => {
    const routed = sourceFiles(join(SRC_ROOT, 'app')).map(relative);
    expect(routed.filter((file) => /fixture|debug|devmenu/i.test(file))).toEqual([]);
    const features = sourceFiles(join(SRC_ROOT, 'features')).map(relative);
    expect(features.filter((file) => /fixture/i.test(file))).toEqual([]);
  });

  it('cannot be chosen by an environment value, a flag or a route parameter', () => {
    for (const { path, code } of UI_SOURCE) {
      expect({
        path,
        matched:
          /process\.env|EXPO_PUBLIC_|__DEV__|useLocalSearchParams|useGlobalSearchParams/.test(code),
      }).toEqual({ path, matched: false });
    }
  });

  it('leaves the production route composing the real adapter with no fallback', () => {
    const route = strip(readFileSync(join(AI_ROUTES, 'chat', '[conversationId].tsx'), 'utf8'));
    // Rendered with no port, so it resolves the real `noorAIService` default.
    expect(route).toMatch(/<NoorAIChatScreen\s*\/>/);
    expect(route).not.toMatch(/port\s*=/);

    const screenCode = strip(
      readFileSync(join(NOOR_AI_FEATURE, 'noor-ai-chat-screen.tsx'), 'utf8'),
    );
    // Exactly one default, and it is the adapter. No catch-substitutes-a-canned-answer path.
    expect(screenCode).toContain('port = noorAIService');
    expect(screenCode).not.toMatch(/FIXTURE|fallback|canned|sample answer/i);
  });

  it('constructs no port anywhere inside the application', () => {
    // Prose mentioning a fixture is fine. What must not exist under `app` or `features` is an
    // *implementation* of the seam, which is what an `ask:` property on an object literal is.
    const offenders = [
      ...sourceFiles(join(SRC_ROOT, 'app')),
      ...sourceFiles(join(SRC_ROOT, 'features')),
    ]
      .filter((file) => /\bask\s*:\s*\(/.test(strip(readFileSync(file, 'utf8'))))
      .map(relative);

    expect(offenders).toEqual([]);
  });
});

describe('the conversation route carries nothing', () => {
  it('reads no route parameter at all', () => {
    for (const { path, code } of UI_SOURCE) {
      expect({
        path,
        matched: /useLocalSearchParams|useSearchParams|route\.params/.test(code),
      }).toEqual({ path, matched: false });
    }
  });

  it('instantiates the dynamic segment with a fixed literal, not a generated id', () => {
    const routes = strip(readFileSync(join(NOOR_AI_FEATURE, 'noor-ai-chat-routes.ts'), 'utf8'));
    expect(routes).toContain("NOOR_AI_EPHEMERAL_CHAT_SEGMENT = 'new'");
    // Nothing that could mint an identifier.
    expect(routes).not.toMatch(/randomUUID|getRandomValues|Math\.random|Date\.now|nanoid|uuid/);
  });

  it('adds no deep-link registration', () => {
    const appConfig = readFileSync(join(REPO_ROOT, 'app.json'), 'utf8');
    // The scheme is Phase 6C-3C's and is unchanged; no intent filter or associated domain is added.
    expect(appConfig).toContain('"scheme": "noorlifeapp"');
    expect(appConfig).not.toContain('intentFilters');
    expect(appConfig).not.toContain('associatedDomains');
  });
});

describe('the local draft rules mirror the adapter exactly', () => {
  const adapter = readFileSync(ADAPTER, 'utf8');
  const draft = readFileSync(join(NOOR_AI_FEATURE, 'noor-ai-message-draft.ts'), 'utf8');

  /** Reads the trimmable character class from a file that declares one. */
  function trimmable(source: string): string {
    const match = /const TRIMMABLE = '([^']*)';/.exec(source);
    expect(match).not.toBeNull();
    return match?.[1] ?? '';
  }

  it('trims the same characters the adapter trims', () => {
    /**
     * The direction a drift would break, stated in the assertion rather than only in prose: a
     * stricter composer blocks a legitimate question behind a disabled button with no explanation,
     * which is worse than a permissive one whose extra questions the adapter refuses anyway. So the
     * two classes must be identical, not merely compatible.
     */
    expect(trimmable(draft)).toBe(trimmable(adapter));
    expect(trimmable(draft).length).toBeGreaterThan(0);
  });

  it('permits the same three control characters', () => {
    const permitted = /const PERMITTED_CONTROLS = new Set\(\[([^\]]*)\]\)/;
    expect(permitted.exec(draft)?.[1]?.replace(/\s/g, '')).toBe(
      permitted.exec(adapter)?.[1]?.replace(/\s/g, ''),
    );
  });

  it('uses the contract’s code-point limit rather than a second number', () => {
    expect(NOOR_AI_DRAFT_MAX_CODE_POINTS).toBe(1000);
    expect(draft).toContain('NOOR_AI_MAX_MESSAGE_CODE_POINTS');
    // No literal limit of its own anywhere in the composer chain.
    expect(strip(draft)).not.toMatch(/=\s*1000\b/);
  });

  it('agrees with the adapter on the four cases it can decide locally', () => {
    expect(evaluateNoorAIDraft('').canSubmit).toBe(false);
    expect(evaluateNoorAIDraft('   ').canSubmit).toBe(false);
    expect(evaluateNoorAIDraft(String.fromCodePoint(0x200b)).canSubmit).toBe(false);
    expect(evaluateNoorAIDraft('a'.repeat(1001)).canSubmit).toBe(false);
    expect(evaluateNoorAIDraft(`a${String.fromCodePoint(0x07)}b`).canSubmit).toBe(false);
    expect(evaluateNoorAIDraft('a'.repeat(1000)).canSubmit).toBe(true);
    expect(evaluateNoorAIDraft('Where is Settings?\n\tSecond line').canSubmit).toBe(true);
  });

  it('counts code points, so an Arabic or emoji question is not penalised', () => {
    // 1000 astral code points are 2000 UTF-16 units; counting units would refuse this wrongly.
    expect(evaluateNoorAIDraft('😀'.repeat(1000)).canSubmit).toBe(true);
    expect(evaluateNoorAIDraft('😀'.repeat(1001)).canSubmit).toBe(false);
  });
});

describe('what this phase left untouched', () => {
  it('leaves the Edge Function kill switch as the literal false', () => {
    const wiring = strip(readFileSync(join(FUNCTION_DIR, 'production.ts'), 'utf8'));
    expect(wiring).toMatch(/enabled:\s*false\s*,/);
    expect(wiring).not.toMatch(/enabled:\s*true/);
    expect(wiring).not.toMatch(/enabled:\s*[^,]*Deno\.env/);
  });

  it('leaves `confirmAction` unimplemented and still required by the full orchestrator', () => {
    const orchestrator = readFileSync(
      join(SRC_ROOT, 'services', 'ai', 'ai-orchestrator.contract.ts'),
      'utf8',
    );
    expect(orchestrator).toMatch(/readonly confirmAction:/);
    expect(orchestrator).not.toMatch(/confirmAction\?:/);

    // And nothing in the UI implements or calls it.
    for (const { path, code } of UI_SOURCE) {
      expect({ path, matched: /confirmAction/.test(code) }).toEqual({ path, matched: false });
    }
  });

  it('leaves the AI-4 ask-only contract unchanged in the fields that matter', () => {
    const contract = readFileSync(join(SRC_ROOT, 'services', 'ai', 'noor-ai.contract.ts'), 'utf8');
    expect(contract).toContain(
      'export interface NoorAIPort extends AIAskOrchestrator<NoorAIResult>',
    );
    expect(contract).toContain('NOOR_AI_ONE_INVOCATION_INVARIANT');
    // The failure outcome still has exactly one field, so nothing can carry free text.
    const failed = /\{ readonly outcome: 'failed';([^}]*)\}/.exec(contract);
    const members = [...(failed?.[1] ?? '').matchAll(/readonly\s+([A-Za-z_]+)\s*:/g)].map(
      (match) => match[1],
    );
    expect(members).toEqual(['failure']);
  });

  it('adds no dependency and no lockfile change of its own', () => {
    const manifest = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    // Nothing an AI UI might reach for: no markdown renderer, no HTML renderer, no state library.
    for (const forbidden of [
      'react-native-markdown-display',
      'react-native-render-html',
      'marked',
      'markdown-it',
      'dompurify',
      'redux',
      'redux-persist',
      'zustand',
      'jotai',
      '@tanstack/react-query',
    ]) {
      expect(Object.keys(manifest.dependencies)).not.toContain(forbidden);
      expect(Object.keys(manifest.devDependencies)).not.toContain(forbidden);
    }
  });
});
