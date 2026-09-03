import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * CI shuffles the order of cases within every file, and says which shuffle it used — issue #155.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Six suites were found passing only in their declared order, and every one was a real defect rather
 * than a harness quirk: an offending case declared last so nothing followed it to break, or an
 * assertion reading an absence a neighbour had created. Two were passing without their interaction
 * having happened at all. Declaration order hid all six.
 *
 * This asserts the two properties that keep them from coming back, and the four that keep the gate
 * honest while they do. It reads the workflow rather than its own source, so it cannot satisfy itself.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const LF = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const WORKFLOW = join(__dirname, '..', '..', '.github', 'workflows', 'ci.yml');

/** The Jest step, comments stripped, so prose about a flag is never mistaken for the flag. */
function jestStep(): string {
  const lines = readFileSync(WORKFLOW, 'utf8')
    .split(LF)
    .map((line) => (line.endsWith(CR) ? line.slice(0, -1) : line));

  const start = lines.findIndex((line) => line.includes('name: Jest'));
  expect(start).toBeGreaterThanOrEqual(0);

  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    // The next step at the same indentation ends this one.
    if (line.trimStart().startsWith('- name:')) break;
    if (line.trim().startsWith('#')) continue;
    body.push(line);
  }
  return body.join(LF);
}

/**
 * The line that actually runs Jest.
 *
 * Asserting flags against the whole step is not enough: the step *echoes* a replay command, and a
 * first version of this file passed with `--randomize` deleted from the real invocation because the
 * echoed line still mentioned it. The command under test is one line, so it is read as one line.
 */
function invocation(): string {
  const line = jestStep()
    .split(LF)
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith('npx jest'));
  expect(line).toBeDefined();
  return line ?? '';
}

describe('the CI test command', () => {
  it('shuffles the order of cases within each file', () => {
    expect(invocation()).toContain('--randomize');
  });

  it('reports the seed, and passes one explicitly so a run is reproducible', () => {
    const step = jestStep();
    /* Printed by Jest in its summary… */
    expect(invocation()).toContain('--showSeed');
    /* …and echoed before the suite starts, which survives a killed or timed-out job. */
    expect(step).toContain('echo "Jest seed: $seed"');
    expect(invocation()).toContain('--seed="$seed"');
  });

  it('does not pin CI to one convenient seed', () => {
    /*
      A literal seed would make the gate a single fixed order — the very thing that hid six defects.
      Checked by reading the character after each `--seed=`: a variable is fine, a digit is not.
    */
    const step = jestStep();
    const needle = '--seed=';
    const pinned: string[] = [];
    for (let at = step.indexOf(needle); at !== -1; at = step.indexOf(needle, at + 1)) {
      const next = step.charAt(at + needle.length);
      if (next >= '0' && next <= '9') {
        pinned.push(step.slice(at, at + 24));
      }
    }
    expect(pinned).toEqual([]);
  });

  it('documents how to replay a reported seed locally', () => {
    const step = jestStep();
    expect(step).toContain('Replay this exact order locally with:');
    expect(step).toContain('npx jest --randomize --seed=$seed');
  });

  it('still runs the complete suite under CI reporting', () => {
    const command = invocation();
    expect(command).toContain('npx jest --ci');
    /* No path filter: the whole suite, discovered the way `package.json` says. */
    expect(command).not.toContain('npx jest --ci src/');
  });

  it('hides no failure behind a retry, a skip, a bigger budget or one worker', () => {
    const step = invocation();
    for (const escape of [
      'retryTimes',
      '--retries',
      '--runInBand',
      '--maxWorkers',
      '--testTimeout',
      '--silent',
      '--bail',
      '--onlyFailures',
      '--passWithNoTests',
    ]) {
      expect(`${escape}: ${step.includes(escape)}`).toBe(`${escape}: false`);
    }
  });
});
