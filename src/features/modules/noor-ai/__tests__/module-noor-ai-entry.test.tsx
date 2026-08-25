import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { NOOR_AI_SURFACE_ALLOW_LIST } from '@services/ai/noor-ai.contract';

import { FRAMEWORK_MODULE_IDS } from '../../module-tokens';
import { moduleRegistry } from '../../module-registry';
import { isFrameworkModuleId, moduleSurfacePath } from '../module-noor-ai-screen';
import { noorAIChatCopy, noorAIModulePrivacyLine } from '../noor-ai-chat-copy';
import { NOOR_AI_CHAT_PATH } from '../noor-ai-chat-routes';

/**
 * **Noor AI, opened from a module** — issue #64, Stage 1, without rendering.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Six module AI pages told the user the assistant was "not connected yet" while `/ai/chat` was
 * calling the real service. This file pins what replaced them, and — more importantly — what the
 * replacement is not allowed to do.
 *
 * The dangerous direction of a change like this is not that it fails to work. It is that a module
 * conversation quietly starts carrying the module's data, because reading a repository is one import
 * away and the resulting screen looks better. So most of what is asserted here is absence, checked
 * against the source rather than against a render: a screen that read a repository under one
 * condition would still pass every behavioural test written for the other conditions.
 *
 * Rendering cases live in `module-noor-ai-render.test.tsx`, split because this project has no React
 * act environment and the conversation surface mounts the whole module scaffold.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const FEATURE_DIR = join(__dirname, '..');
const APP_ROOT = join(__dirname, '..', '..', '..', '..', 'app');

/** Comment-stripped, so prose naming a repository can never stand in for importing one. */
function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

/** The module AI route files, read from disk. */
function moduleAIRoutes(): readonly { readonly moduleId: string; readonly file: string }[] {
  return readdirSync(APP_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({ moduleId: entry.name, file: join(APP_ROOT, entry.name, 'ai.tsx') }))
    .filter((candidate) => {
      try {
        readFileSync(candidate.file, 'utf8');
        return true;
      } catch {
        return false;
      }
    });
}

/** The six that share the generic entry. Faith is deliberately not one of them — see below. */
const SHARED_ENTRY_MODULES = ['family', 'finance', 'goals', 'health', 'learning', 'planner'];

// ─────────────────────────────────────────────────────────────────────────────
// Coverage of the route tree, by construction
// ─────────────────────────────────────────────────────────────────────────────

describe('every module AI route', () => {
  it('resolves to the shared entry, or to Faith’s own audited implementation', () => {
    /*
      The whole set, read from disk. A new module AI route added without integration lands here as a
      failure rather than as a screen nobody classified — which is the same guarantee the protected
      route table gets, for the same reason.

      Faith is the one exception and it is an audited one. Its screen is not the shared placeholder:
      it says replies "are samples that demonstrate its limits", which is *accurate*, because Faith
      serves canned replies from its own `faith-ai.repository` and is genuinely not wired to the real
      service. It also carries verse context, Arabic rendering and an unverified-source notice that
      the generic conversation has no equivalent for. So it keeps its implementation, and whether it
      should migrate is a separate product question.
    */
    for (const route of moduleAIRoutes()) {
      const body = code(route.file);
      if (route.moduleId === 'faith') {
        expect(body).toContain('FaithAiScreen');
        continue;
      }
      if (route.moduleId === 'ai') {
        continue;
      }
      expect(SHARED_ENTRY_MODULES).toContain(route.moduleId);
      expect(body).toContain('ModuleNoorAIScreen');
      expect(body).toContain(`moduleId="${route.moduleId}"`);
    }
  });

  it('covers all six shared-entry modules and no more', () => {
    const shared = moduleAIRoutes()
      .filter((route) => code(route.file).includes('ModuleNoorAIScreen'))
      .map((route) => route.moduleId)
      .sort();
    expect(shared).toEqual([...SHARED_ENTRY_MODULES].sort());
  });

  it('no longer renders the screen that said the assistant was disconnected', () => {
    /*
      The false claim, gone at the source. Asserted as the file's absence rather than as copy that no
      longer appears, because a component nobody renders is a component somebody re-renders.
    */
    expect(() =>
      readFileSync(join(FEATURE_DIR, '..', 'screens', 'module-ai-screen.tsx'), 'utf8'),
    ).toThrow();
    for (const route of moduleAIRoutes()) {
      if (route.moduleId === 'faith' || route.moduleId === 'ai') {
        continue;
      }
      expect(code(route.file)).not.toContain('ModuleAIScreen');
      expect(readFileSync(route.file, 'utf8')).not.toMatch(/not connected yet/i);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The module identifier: closed, validated, and only two things it may affect
// ─────────────────────────────────────────────────────────────────────────────

describe('the module identifier', () => {
  it('accepts every module the registry defines', () => {
    for (const moduleId of FRAMEWORK_MODULE_IDS) {
      expect(isFrameworkModuleId(moduleId)).toBe(true);
    }
  });

  it.each(['main', 'unknown', '', 'FINANCE', '../finance', 'finance/ai', '/finance', '__proto__'])(
    'fails closed on %p',
    (candidate) => {
      /*
      A membership test against the declared set, not a shape check. Case, traversal, a leading
      slash and a prototype key are all simply not members — which is the point of asking the
      registry rather than parsing the string.
    */
      expect(isFrameworkModuleId(candidate)).toBe(false);
    },
  );

  it('travels as an allow-listed surface, so no backend change is needed', () => {
    /*
      §C.5's list already contains every module's home path, and the client's copy is mirrored from
      the server's own and drift-tested. So the module a question came from reaches the wire in the
      one field the contract provides for it — not appended to the user's text, and not as a new
      field the server would reject by name.
    */
    for (const moduleId of SHARED_ENTRY_MODULES) {
      const home = moduleRegistry[moduleId as (typeof FRAMEWORK_MODULE_IDS)[number]].routes.home;
      expect(typeof home).toBe('string');
      expect(NOOR_AI_SURFACE_ALLOW_LIST).toContain(home);
      expect(moduleSurfacePath(moduleId as (typeof FRAMEWORK_MODULE_IDS)[number])).toBe(home);
    }
  });

  it('reports the generic path rather than an unlisted one', () => {
    /*
      The forgiving direction. A module whose home path is not on the allow-list reports the generic
      chat path, so the observable outcome is today's behaviour rather than a value the adapter would
      silently drop.
    */
    expect(NOOR_AI_SURFACE_ALLOW_LIST).not.toContain(NOOR_AI_CHAT_PATH);
    for (const moduleId of FRAMEWORK_MODULE_IDS) {
      const surface = moduleSurfacePath(moduleId);
      expect(surface === NOOR_AI_CHAT_PATH || NOOR_AI_SURFACE_ALLOW_LIST.includes(surface)).toBe(
        true,
      );
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// What the entry may never reach
// ─────────────────────────────────────────────────────────────────────────────

describe('the privacy boundary', () => {
  const ENTRY = join(FEATURE_DIR, 'module-noor-ai-screen.tsx');
  const BODY = join(FEATURE_DIR, 'noor-ai-chat-screen.tsx');

  it.each([
    ['repository', /repositor/i],
    ['storage', /storage|SecureStore|AsyncStorage/],
    ['module records', /\bruns\b|transactions|medications|tasksFor|readTasks|readRecords/],
    ['account profile', /getProfile|useProfile|accountJourney/],
    ['Faith storage', /faith-storage|faithScope|quranSelection|prayerState/],
  ])('imports no %s', (_label, pattern) => {
    /*
      Absence, checked at the source of both files a module conversation is made of. A behavioural
      test cannot prove this: a screen that read a repository only when an entitlement was held would
      pass every case written for the entitlement it did not hold.
    */
    expect(code(ENTRY)).not.toMatch(pattern);
    expect(code(BODY)).not.toMatch(pattern);
  });

  it('sends only the text the user typed', () => {
    /*
      One call site, one argument. `evaluateNoorAIDraft` returns the trimmed draft and nothing else,
      so there is no expression at the call that could concatenate a record, a name or a module value
      into the message.
    */
    const body = code(BODY);
    expect(body).toContain('port.ask(check.message, context');
    expect(body.match(/port\.ask\(/g)).toHaveLength(1);
    expect(body).not.toMatch(/ask\([^)]*\+/);
  });

  it('re-checks the draft inside the handler, not only on the button', () => {
    /*
      Defence in depth, and asserted at the source because nothing in the UI can reach past it.

      The send control is `disabled={!sendEnabled}`, so a press with an unsendable draft never calls
      the handler — which means the render suite's "cannot send an empty question" case proves the
      *button* is right and cannot prove the handler is. The handler's own re-check exists for the
      three callers that are not the button: a press queued before React re-rendered, a stale closure,
      and a programmatic call. Its docblock says exactly that.

      A mutation removing the re-check passed every behavioural test. This is the case that fails.
    */
    const body = code(BODY);
    expect(body).toContain('const check = evaluateNoorAIDraft(draft);');
    expect(body).toContain('if (!check.canSubmit)');
    /* And the synchronous double-press mark, for the same reason. */
    expect(body).toContain('if (inFlight.current)');
  });

  it('states plainly that the module’s data is not read', () => {
    const line = noorAIModulePrivacyLine('Finance');
    expect(line).toBe(
      'Noor AI does not read your Finance data automatically. Share only what you choose to type.',
    );
    /* One template, so eight modules cannot become eight different promises. */
    for (const moduleId of SHARED_ENTRY_MODULES) {
      const name = moduleRegistry[moduleId as (typeof FRAMEWORK_MODULE_IDS)[number]].name;
      expect(noorAIModulePrivacyLine(name)).toContain(name);
      expect(noorAIModulePrivacyLine(name)).toContain('does not read your');
      expect(noorAIModulePrivacyLine(name)).toContain('only what you choose to type');
    }
  });

  it('claims no permission, grant or revocation anywhere in the copy', () => {
    /*
      Stage 2's vocabulary, kept out. There is no grant store, no share preview and no way to
      withdraw anything — `/ai/permissions` and `/settings/ai-permissions` are both placeholders — so
      wording implying any of them would be the same class of false claim this entry removed.

      `noModuleAccess` is exempt: it is the *denial*, and it already says access is not available.
    */
    const line = noorAIModulePrivacyLine('Health');
    for (const forbidden of ['permission', 'grant', 'allow', 'revoke', 'consent', 'setting']) {
      expect(line.toLowerCase()).not.toContain(forbidden);
    }
  });

  it('keeps the professional-advice boundary on every module conversation', () => {
    /*
      What the removed per-module disclaimers used to carry on two modules, now stated on all of them
      by the shared scope note above the composer.
    */
    expect(noorAIChatCopy.scope.notAnAuthority).toMatch(/not a scholar, imam, doctor/i);
    expect(noorAIChatCopy.scope.noModuleAccessDetail).toMatch(/not reading your/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The generic surface, unchanged
// ─────────────────────────────────────────────────────────────────────────────

describe('the existing Noor AI module', () => {
  it('still reports its own chat path, not a module one', () => {
    const body = code(join(FEATURE_DIR, 'noor-ai-chat-screen.tsx'));
    expect(body).toContain('surfacePath={NOOR_AI_CHAT_PATH}');
  });

  it('keeps its own route and screen', () => {
    expect(code(join(APP_ROOT, 'ai', 'chat', '[conversationId].tsx'))).toContain(
      'NoorAIChatScreen',
    );
  });
});
