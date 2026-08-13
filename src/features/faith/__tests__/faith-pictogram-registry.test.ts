import fs from 'node:fs';
import path from 'node:path';

import {
  expectedFaithPictogramFiles,
  faithPictograms,
  FAITH_PICTOGRAM_DIR,
  faithPictogramSlot,
  getFaithPictogram,
  heldFaithPictograms,
  pendingFaithPictograms,
  type FaithPictogramId,
} from '../faith-pictogram-assets';

/**
 * The gate that stops a temporary stand-in from shipping as approved artwork.
 *
 * ── Why this test arms itself ───────────────────────────────────────────────
 * The dangerous moment is not today, while every slot is obviously unfilled and the screens carry a
 * shouting development panel. It is the day the PNGs are copied in and fourteen of the sixteen
 * slots get wired: the two that were missed keep rendering a vector, they look deliberate beside
 * fourteen that are right, and nothing fails.
 *
 * So the central case reads the directory rather than a list: **a PNG present on disk whose slot is
 * still `awaiting-artwork` is a failure.** Copying artwork in therefore turns the test red until
 * the registry is updated, which is the opposite of the usual failure mode where nothing happens.
 *
 * ── What it deliberately does not do ────────────────────────────────────────
 * It does not fail because the files are absent. Their absence is the recorded, approved state
 * while artwork is being produced elsewhere, and a test that failed for it would be red for the
 * whole of that period and would be disabled by the second day.
 */

const REPO_ROOT = process.cwd();
const PICTOGRAM_DIR = path.join(REPO_ROOT, ...FAITH_PICTOGRAM_DIR.split('/'));

function installedFiles(): readonly string[] {
  if (!fs.existsSync(PICTOGRAM_DIR)) {
    return [];
  }
  return fs.readdirSync(PICTOGRAM_DIR).filter((name) => name.toLowerCase().endsWith('.png'));
}

describe('the pictogram registry is complete and statically resolved', () => {
  it('registers all sixteen slots the approved designs introduce', () => {
    const ids = faithPictograms.map((entry) => entry.id);
    expect(ids).toEqual([
      'h1',
      'h2',
      'h3',
      'd1',
      'd2',
      'd3',
      's1',
      'p1',
      'p2-fajr',
      'p2-sunrise',
      'p2-dhuhr',
      'p2-asr',
      'p2-maghrib',
      'p2-isha',
      'p3',
      'p4',
    ] satisfies readonly FaithPictogramId[]);
  });

  /**
   * D3 reuses H2's image rather than carrying a second drawing of the same subject.
   *
   * Asserted rather than left to the table, because "generate a Duas bookmark icon" is the obvious
   * thing to do next time somebody reads the slot list and does not read the note beside it.
   */
  it('points D3 at H2’s file', () => {
    expect(getFaithPictogram('d3').file).toBe(getFaithPictogram('h2').file);
    expect(expectedFaithPictogramFiles).toHaveLength(15);
  });

  it('expects every file under the one documented directory', () => {
    expect(FAITH_PICTOGRAM_DIR).toBe('assets/images/modules/faith/pictograms');
    for (const file of expectedFaithPictogramFiles) {
      expect(file).toMatch(/^[a-z0-9-]+\.png$/);
    }
  });

  /**
   * No dynamic path, anywhere in the registry.
   *
   * A source scan rather than a behavioural check, because the defect it prevents is invisible at
   * runtime in development: Metro resolves a template-string `require` to nothing only in a release
   * bundle, so a dynamic path passes every test and every debug build and fails in the store.
   */
  it('builds no require path from a variable or a template string', () => {
    const source = fs.readFileSync(
      path.join(REPO_ROOT, 'src/features/faith/faith-pictogram-assets.ts'),
      'utf8',
    );
    const executable = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

    // Every `require(` in executable code must be immediately followed by a quoted literal path.
    const requires = executable.match(/require\(\s*[^'"]/g) ?? [];
    expect(requires).toEqual([]);
    expect(executable).not.toMatch(/require\(`/);
    expect(executable).not.toMatch(/import\(/);
  });

  it('resolves a slot for every registered id', () => {
    for (const entry of faithPictograms) {
      const slot = faithPictogramSlot(entry.id);
      expect(slot.kind === 'png' || slot.kind === 'vector').toBe(true);
    }
  });

  it('throws on an unknown id rather than returning a fallback', () => {
    expect(() => getFaithPictogram('nope' as FaithPictogramId)).toThrow(/No Faith pictogram/);
  });
});

describe('no approved slot renders a stand-in once its artwork exists', () => {
  const present = installedFiles();

  /**
   * The self-arming case. See the file note.
   *
   * `it.each` over the *registry* rather than over the files, so the failure names the slot that
   * needs a decision rather than the file that arrived.
   *
   * ── Why `held` is accepted here and `awaiting-artwork` is not ──────────────
   * Both render the same restrained vector, so a renderer cannot tell them apart. The audit can, and
   * must: `awaiting-artwork` beside a PNG on disk is a slot somebody forgot, while `held` is a slot
   * somebody decided about and wrote down. Accepting only `installed` would have forced P3's bell to
   * be wired the moment it landed — with a red test as the pressure — which is the opposite of what
   * the hold is for.
   */
  it.each(faithPictograms.map((entry) => [entry.id, entry.file] as const))(
    '%s is installed or explicitly held once %s has been supplied',
    (id, file) => {
      if (!present.includes(file)) {
        // Absent artwork is the recorded state, not a failure. See the file note.
        return;
      }
      const entry = getFaithPictogram(id);
      expect(entry.asset.status).not.toBe('awaiting-artwork');

      if (entry.asset.status === 'installed') {
        expect(faithPictogramSlot(id).kind).toBe('png');
      } else {
        // A held slot renders the restrained vector, exactly as it did before its artwork arrived.
        expect(faithPictogramSlot(id).kind).toBe('vector');
      }
    },
  );

  it('has no pending slot left once every expected file is present', () => {
    const everythingSupplied = expectedFaithPictogramFiles.every((file) => present.includes(file));
    if (!everythingSupplied) {
      return;
    }
    /*
      Reachable *because* `held` is excluded from pending. With two states this assertion and the
      hold on P3 were in direct conflict, and the cheapest way to satisfy both would have been to
      wire the bell.
    */
    expect(pendingFaithPictograms()).toEqual([]);
  });

  /**
   * Nothing in the directory that the registry does not know about.
   *
   * An unregistered PNG is either a misspelling of a slot's filename — in which case the slot it was
   * meant for is still rendering a stand-in — or artwork nobody has decided where to use. Both are
   * worth stopping, and the second is how a stray working file gets bundled.
   */
  it('holds no PNG the registry does not reference', () => {
    for (const file of present) {
      expect(expectedFaithPictogramFiles).toContain(file);
    }
  });
});

/**
 * A held slot is delivered, registered, deliberately unrendered, and says why.
 *
 * ── What these guard ────────────────────────────────────────────────────────
 * `held` exists so that P3's bell can sit in the repository without appearing beside a switch that
 * schedules nothing. That is only worth anything if the state cannot be used as a quiet way to
 * silence the on-disk audit — so a hold must carry a reason, must not resolve to a rendered image,
 * and must not pull its file into the bundle.
 */
describe('held slots are accounted for without being rendered', () => {
  it('holds exactly P3, for a stated reason', () => {
    const held = heldFaithPictograms();
    expect(held.map((entry) => entry.id)).toEqual(['p3']);

    const [entry] = held;
    expect(entry?.asset.status).toBe('held');
    if (entry?.asset.status === 'held') {
      // Non-empty, and long enough to be an explanation rather than a label.
      expect(entry.asset.heldReason.trim().length).toBeGreaterThan(40);
      expect(entry.asset.heldReason).toMatch(/notification/i);
    }
  });

  it('renders the restrained vector rather than the held artwork', () => {
    const slot = faithPictogramSlot('p3');
    expect(slot.kind).toBe('vector');
    expect(JSON.stringify(slot)).not.toMatch(/p3-reminder-bell/);
  });

  /**
   * No `require` for a held file, anywhere in the module.
   *
   * A source scan rather than a runtime check, because the guarantee is about the *bundle*: a
   * `require` would pull the bell into the app whether or not anything drew it, and the point of the
   * hold is that there is nothing to draw. Scanned across the whole Faith tree, not just the
   * registry, so a screen cannot import it directly either.
   */
  it('never requires a held asset from anywhere in the module', () => {
    const roots = [
      path.join(REPO_ROOT, 'src/features/faith'),
      path.join(REPO_ROOT, 'src/features/modules/faith'),
    ];
    const walk = (dir: string): readonly string[] =>
      fs.existsSync(dir)
        ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((item) => {
            const full = path.join(dir, item.name);
            if (item.isDirectory()) return item.name === '__tests__' ? [] : walk(full);
            return /\.tsx?$/.test(item.name) ? [full] : [];
          })
        : [];

    for (const entry of heldFaithPictograms()) {
      for (const file of roots.flatMap(walk)) {
        expect(fs.readFileSync(file, 'utf8')).not.toMatch(
          new RegExp(`require\\([^)]*${entry.file.replace('.', '\\.')}`),
        );
      }
    }
  });

  /** A held slot is not pending. This is the property that lets the set reach zero pending. */
  it('excludes held slots from the pending list', () => {
    const heldIds = new Set(heldFaithPictograms().map((entry) => entry.id));
    for (const entry of pendingFaithPictograms()) {
      expect(heldIds.has(entry.id)).toBe(false);
    }
  });
});

/**
 * The end state this whole exercise was aiming at.
 *
 * Written as explicit counts rather than as "everything is fine", because the numbers are the thing
 * a reader wants and because a future slot added without a decision would move one of them.
 */
describe('the installed set is complete', () => {
  it('is 15 installed, 1 held, 0 awaiting artwork', () => {
    const by = (status: string) =>
      faithPictograms.filter((entry) => entry.asset.status === status).length;

    expect(by('installed')).toBe(15);
    expect(by('held')).toBe(1);
    expect(by('awaiting-artwork')).toBe(0);
    expect(pendingFaithPictograms()).toEqual([]);
  });

  it('has every expected file on disk', () => {
    for (const file of expectedFaithPictogramFiles) {
      expect(fs.existsSync(path.join(PICTOGRAM_DIR, file))).toBe(true);
    }
  });

  /**
   * D3 hands the renderer the *same source object* as H2.
   *
   * Identical literal paths let Metro dedupe to one bundled image, so this proves the reuse is real
   * rather than two entries that happen to name the same file today.
   */
  it('reuses H2’s image for D3, as one bundled asset', () => {
    const h2 = faithPictogramSlot('h2');
    const d3 = faithPictogramSlot('d3');

    expect(h2.kind).toBe('png');
    expect(d3.kind).toBe('png');
    if (h2.kind === 'png' && d3.kind === 'png') {
      expect(d3.source).toBe(h2.source);
    }
    expect(getFaithPictogram('d3').file).toBe(getFaithPictogram('h2').file);
  });

  /** No vector fallback survives on an installed slot. */
  it('leaves no installed slot resolving to a vector', () => {
    for (const entry of faithPictograms) {
      if (entry.asset.status !== 'installed') continue;
      expect(faithPictogramSlot(entry.id).kind).toBe('png');
    }
  });
});

/**
 * The development stand-in is visible, temporary and honestly described.
 *
 * These assert the *scaffolding*, not the artwork: that unresolved slots stay enumerable and
 * described, so the mechanism still works for the next batch. Both lists are empty of
 * `awaiting-artwork` today, which is why they are written to hold vacuously rather than to assume a
 * pending slot exists.
 */
describe('the temporary fallback states what it is', () => {
  it('reports every unfilled slot with its subject and destination file', () => {
    for (const entry of [...pendingFaithPictograms(), ...heldFaithPictograms()]) {
      // Long enough to name a subject — "Asr sun" is the shortest and is a complete one.
      expect(entry.subject.length).toBeGreaterThan(5);
      expect(entry.file).toMatch(/\.png$/);
      expect(entry.renderedAtDp).toBeGreaterThan(0);
    }
  });

  /** No emoji reaches a slot, in either variant. The registry holds paths and icon names only. */
  it('uses no emoji as a pictogram', () => {
    const source = fs.readFileSync(
      path.join(REPO_ROOT, 'src/features/faith/faith-pictogram-assets.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  });
});
