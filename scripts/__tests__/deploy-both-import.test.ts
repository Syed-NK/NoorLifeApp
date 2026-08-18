/**
 * `scripts/deploy-both.js` must do nothing when it is imported.
 *
 * It used to run at module scope: `require`-ing it started a Gradle release build and then
 * `adb install` on every attached device. Nothing imported it, so nothing was triggering it — but
 * that is a fact about today's call sites, not a property of the script. This pins the property.
 *
 * The child_process module is replaced wholesale, so if the guard ever regresses this test records
 * the attempted build instead of performing one. `deploy:both` is never executed here.
 */

jest.mock('node:child_process', () => ({
  execSync: jest.fn(),
  execFileSync: jest.fn(),
  spawnSync: jest.fn(() => ({ status: 0, stdout: '', stderr: '' })),
}));

const SCRIPT = '../deploy-both.js';

describe('importing scripts/deploy-both.js', () => {
  let exitSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    exitSpy = jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code}) called on import`);
    }) as never);
  });

  afterEach(() => {
    exitSpy.mockRestore();
  });

  it('starts no build and no install', () => {
    const childProcess = require('node:child_process');

    jest.isolateModules(() => {
      require(SCRIPT);
    });

    expect(childProcess.execSync).not.toHaveBeenCalled();
    expect(childProcess.execFileSync).not.toHaveBeenCalled();
  });

  it('does not terminate the process', () => {
    jest.isolateModules(() => {
      require(SCRIPT);
    });

    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('exports the entry point instead of running it', () => {
    let exported: unknown;
    jest.isolateModules(() => {
      exported = require(SCRIPT);
    });

    expect(typeof (exported as { main?: unknown }).main).toBe('function');
  });

  it('guards execution on require.main, so npm run deploy:both still works', () => {
    const fs = jest.requireActual('node:fs') as typeof import('node:fs');
    const path = jest.requireActual('node:path') as typeof import('node:path');
    const source = fs.readFileSync(path.join(process.cwd(), 'scripts/deploy-both.js'), 'utf8');

    expect(source).toContain('if (require.main === module)');
    expect(source).toContain('main();');
    // The side-effecting statements must live inside main(), not at module scope.
    expect(source).not.toMatch(/^if \(!skipBuild\) \{$/m);
    expect(source).not.toMatch(/^for \(const serial of found\) \{$/m);
  });
});
