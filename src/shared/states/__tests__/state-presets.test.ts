import type { AppStateKind } from '../app-state';
import { getStatePreset, statePresets } from '../state-presets';

/**
 * Shared-state coverage tests.
 *
 * Workflow §15 lists the states every asynchronous feature must support and
 * forbids per-module state components. These tests assert the shared vocabulary
 * actually covers that list, so a module cannot be forced to invent its own.
 */

const requiredKinds: readonly AppStateKind[] = [
  'loading',
  'empty',
  'first-use-empty',
  'error',
  'server-unavailable',
  'offline',
  'slow-network',
  'no-results',
  'permission-required',
  'permission-denied',
  'session-expired',
  'validation-error',
  'success',
  'ai-unavailable',
  'ai-safety-boundary',
];

describe('shared state coverage', () => {
  it('defines a preset for every required state', () => {
    expect(Object.keys(statePresets).sort()).toEqual([...requiredKinds].sort());
  });

  it.each(requiredKinds)('%s has a title, message, mascot and icon', (kind) => {
    const preset = getStatePreset(kind);
    expect(preset.kind).toBe(kind);
    expect(preset.title.length).toBeGreaterThan(0);
    expect(preset.message.length).toBeGreaterThan(0);
    expect(preset.mascot.length).toBeGreaterThan(0);
    expect(preset.icon.length).toBeGreaterThan(0);
  });

  it('uses the titles named verbatim in the specification', () => {
    expect(statePresets.empty.title).toBe('Nothing here yet');
    expect(statePresets.error.title).toBe('Something went wrong');
    expect(statePresets.offline.title).toBe("You're offline");
    expect(statePresets['slow-network'].title).toBe('Connection is slow');
    expect(statePresets['no-results'].title).toBe('No results found');
    expect(statePresets['session-expired'].title).toBe('Your session has expired');
    expect(statePresets.success.title).toBe('All done!');
  });

  it('gives every recoverable state a primary action', () => {
    const recoverable: readonly AppStateKind[] = [
      'error',
      'server-unavailable',
      'offline',
      'slow-network',
      'no-results',
      'permission-required',
      'permission-denied',
      'session-expired',
      'validation-error',
      'ai-unavailable',
    ];
    for (const kind of recoverable) {
      expect(getStatePreset(kind).primaryActionLabel).toBeDefined();
    }
  });

  it('offers a way to continue without AI when AI is unavailable', () => {
    expect(statePresets['ai-unavailable'].secondaryActionLabel).toBe('Continue without AI');
  });

  it('routes AI states through the AI tone so they inherit the module accent', () => {
    expect(statePresets['ai-unavailable'].tone).toBe('ai');
    expect(statePresets['ai-safety-boundary'].tone).toBe('ai');
  });

  it('reassures the user their data is safe where the specification requires it', () => {
    expect(statePresets['session-expired'].message).toMatch(/data is safe/i);
    expect(statePresets['server-unavailable'].message).toMatch(/safe/i);
    expect(statePresets['ai-unavailable'].message).toMatch(/data is safe/i);
  });
});
