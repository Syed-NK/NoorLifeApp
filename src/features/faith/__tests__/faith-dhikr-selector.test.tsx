import AsyncStorage from '@react-native-async-storage/async-storage';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';

import { warmUpFirstMount } from '@/test-support/mock-latency-timers';

import { createMockFaithRepositories } from '../data/mock';
import {
  dhikrCatalogue,
  DHIKR_CATEGORIES,
  lockMessage,
  matchesQuery,
  type DhikrLockReason,
} from '../data/tasbih/dhikr-catalogue';
import { DEFAULT_COUNTER } from '../data/tasbih/local-tasbih.repository';
import { FaithRepositoryProvider } from '../di/faith-repository-context';
import { DhikrSelectorScreen } from '../screens/dhikr-selector-screen';

/**
 * **The dhikr selector: what it offers, and what it must refuse to offer.**
 *
 * ── The failure these cases exist to prevent ────────────────────────────────
 * Five dhikr presets once shipped in this app with no Arabic source, no translation licence and no
 * attribution, and had to be removed. The pressure that produced them is still here — a selector
 * with one working section looks unfinished, and the cheapest way to make it look finished is to
 * type in some well-known text.
 *
 * So the assertions below are mostly negative, and deliberately so: no Arabic anywhere, no
 * placeholder rows in a locked section, and no personal label that could be mistaken for content
 * NoorLife verified.
 */
warmUpFirstMount(() => renderSelector());

beforeEach(async () => {
  await AsyncStorage.clear();
});

afterEach(async () => {
  await cleanup();
});

/**
 * Lets a `changeText` land before the press that depends on it.
 *
 * This project has no React `act` environment, so `fireEvent` does not flush: a press fired in the
 * same tick as a `changeText` still sees the *previous* draft, and `createLabel('')` is rejected by
 * the repository for having no name. The symptom is a counter that never appears, which reads as a
 * broken create flow rather than as a test that typed and submitted too quickly.
 */
async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function renderSelector(): Promise<typeof screen> {
  await render(
    <FaithRepositoryProvider repositories={createMockFaithRepositories()}>
      <DhikrSelectorScreen />
    </FaithRepositoryProvider>,
  );
  return screen;
}

describe('the shape of the selector', () => {
  it('offers search, category filters and every section', async () => {
    const view = await renderSelector();

    await view.findByTestId('faith-dhikr-search');
    expect(view.getByTestId('faith-dhikr-filters')).toBeTruthy();
    for (const id of ['verified', 'quran', 'personal', 'favourites', 'recent']) {
      expect(view.getByTestId(`faith-dhikr-section-${id}`)).toBeTruthy();
    }
  });

  it('offers a filter for every category the catalogue names', async () => {
    const view = await renderSelector();
    await view.findByTestId('faith-dhikr-filters');

    for (const category of DHIKR_CATEGORIES) {
      expect(view.getByTestId(`faith-dhikr-filter-${category.id}`)).toBeTruthy();
    }
  });
});

describe('locked sections are shut, not faked', () => {
  it('shows verified dhikr as awaiting permission, with nothing in it', async () => {
    const view = await renderSelector();

    const notice = await view.findByTestId('faith-dhikr-verified-locked');
    const message = String(notice.props.accessibilityLabel);
    expect(message).toMatch(/not available yet/i);
    // The one sentence a reader needs: nothing was quietly substituted while permission is pending.
    expect(message).toMatch(/no copied text/i);
    expect(message).toMatch(/no placeholders/i);
  });

  /**
   * ── This assertion was inverted by the 2026-08 permission ───────────────────
   * It used to require the notice to say the *provider* had not confirmed this use. That became
   * false: Quran Foundation gave written permission for a Quran-derived Dhikr selector under
   * NoorLife's existing Content API access, with no new scope, fee or production approval.
   *
   * What is still outstanding is NoorLife's **own scholarly review**, which the vendor's terms say
   * nothing about. So the notice must now say that — and it must not blame the provider for a gap
   * that is NoorLife's. The "will not choose which verses" sentence survives unchanged, because the
   * reason it was there is the reason the section is still shut.
   */
  it('shows Quran-derived dhikr as awaiting scholarly review, and does not curate a list', async () => {
    const view = await renderSelector();

    const notice = await view.findByTestId('faith-dhikr-quran-locked');
    const message = String(notice.props.accessibilityLabel);
    expect(message).toMatch(/awaiting scholarly review/i);
    // The permission is in place, and the notice says so rather than implying the vendor is the gap.
    expect(message).toMatch(/quran foundation has given permission/i);
    // NoorLife will not decide which verses count as dhikr on its own — that is the whole reason.
    expect(message).toMatch(/will not choose which verses/i);
    // And it must not have kept the old, now-false claim that the provider has not confirmed.
    expect(message).not.toMatch(/not yet confirmed/i);
  });

  it('renders no Arabic anywhere on the screen', async () => {
    const view = await renderSelector();
    await view.findByTestId('faith-dhikr-search');

    /*
      A blunt instrument on purpose. Any Arabic-block codepoint reaching this screen means religious
      text arrived without a licence — there is no legitimate source for it in this release. The
      whole rendered tree is serialised rather than a list of known nodes, so a section added later
      is covered without anyone remembering to add it here.
    */
    const arabic = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/;
    expect(JSON.stringify(view.toJSON())).not.toMatch(arabic);
  });

  it('names every lock reason distinctly', () => {
    const reasons: readonly DhikrLockReason[] = [
      'permission-pending',
      'awaiting-scholarly-review',
      'offline',
      'provider-unavailable',
    ];
    const titles = reasons.map((reason) => lockMessage(reason).title);

    // Four different situations, four different answers — "offline" is the user's problem to fix,
    // "permission-pending" is not, and collapsing them would misdirect the one who can act.
    expect(new Set(titles).size).toBe(reasons.length);
  });
});

describe('personal counters are fully functional', () => {
  it('starts with an honest empty state rather than a suggestion', async () => {
    const view = await renderSelector();

    const empty = await view.findByTestId('faith-dhikr-personal-empty');
    expect(String(empty.props.children)).toMatch(/no personal counters yet/i);
    // And it says what a personal counter is, so nobody expects NoorLife to vouch for it.
    expect(String(empty.props.children)).toMatch(/no religious claim/i);
  });

  it('creates, renames and removes a private label', async () => {
    const view = await renderSelector();

    fireEvent.changeText(await view.findByTestId('faith-dhikr-new-input'), 'Morning count');
    await flush();
    fireEvent.press(view.getByTestId('faith-dhikr-create'));

    const row = await waitFor(() => view.getByTestId(/^faith-dhikr-counter-user-/));
    const id = String(row.props.testID).replace('faith-dhikr-counter-', '');

    fireEvent.press(view.getByTestId(`faith-dhikr-rename-${id}`));
    // Entering rename mode is a state change too, so the field does not exist until it lands.
    await flush();
    fireEvent.changeText(view.getByTestId(`faith-dhikr-rename-input-${id}`), 'Evening count');
    await flush();
    fireEvent.press(view.getByTestId(`faith-dhikr-rename-save-${id}`));

    await waitFor(() => expect(view.queryByText('Evening count')).not.toBeNull());
    // The id survives the rename, so the session and history still point at the same counter.
    expect(view.getByTestId(`faith-dhikr-counter-${id}`)).toBeTruthy();

    fireEvent.press(view.getByTestId(`faith-dhikr-remove-${id}`));
    await waitFor(() => expect(view.queryByText('Evening count')).toBeNull());
  });

  it('marks every private label as Personal, in the row and to a screen reader', async () => {
    const view = await renderSelector();

    fireEvent.changeText(await view.findByTestId('faith-dhikr-new-input'), 'My own count');
    await flush();
    fireEvent.press(view.getByTestId('faith-dhikr-create'));

    await waitFor(() => expect(view.queryByText('My own count')).not.toBeNull());

    const row = view.getByTestId(/^faith-dhikr-counter-user-/);
    /*
      The word travels with the label in both channels. A private string sitting in a list called
      "dhikr" is exactly what must not be read as scripture NoorLife stands behind.
    */
    expect(String(row.props.accessibilityLabel)).toMatch(/personal counter/i);
    expect(view.getAllByText('Personal').length).toBeGreaterThan(0);
  });

  it('never offers the neutral default for removal, because it never lists it', async () => {
    const view = await renderSelector();
    await view.findByTestId('faith-dhikr-section-personal');

    // Not guarded — absent. The default cannot be deleted because it is not among the rows.
    expect(view.queryByTestId(`faith-dhikr-counter-${DEFAULT_COUNTER.id}`)).toBeNull();
    expect(view.queryByTestId(`faith-dhikr-remove-${DEFAULT_COUNTER.id}`)).toBeNull();
  });
});

describe('the catalogue model', () => {
  it('locks both content sections whatever the user has locally', () => {
    const sections = dhikrCatalogue({
      personal: [{ id: 'user-1', name: 'Mine', target: 33 }],
      favourites: ['user-1'],
      recent: ['user-1'],
    });

    // Personal data must never unlock a licensed section by accident.
    expect(sections.find((s) => s.id === 'verified')?.state.kind).toBe('locked');
    expect(sections.find((s) => s.id === 'quran')?.state.kind).toBe('locked');
  });

  it('reports personal as empty only when there is nothing', () => {
    const none = dhikrCatalogue({ personal: [], favourites: [], recent: [] });
    expect(none.find((s) => s.id === 'personal')?.state.kind).toBe('empty');

    const some = dhikrCatalogue({
      personal: [{ id: 'user-1', name: 'Mine', target: 33 }],
      favourites: [],
      recent: [],
    });
    expect(some.find((s) => s.id === 'personal')?.state.kind).toBe('ready');
  });

  it('maps every Hadith-derived category onto the locked verified section', () => {
    for (const category of DHIKR_CATEGORIES) {
      /*
        `selections` joins these two: it is the user's own Quran selections, which are neither
        Hadith-derived nor locked. It maps to its own section for the same reason `personal` does —
        it holds something that actually works.
      */
      if (category.id === 'quranic' || category.id === 'personal' || category.id === 'selections') {
        continue;
      }
      /*
        Morning & Evening, After Prayer, Praise, Forgiveness and Protection are all Hadith-derived.
        Pointing them at `verified` is what makes selecting one show the honest lock rather than an
        empty result implying the category exists and simply matched nothing.
      */
      expect(category.section).toBe('verified');
    }
  });

  it('searches a personal label by its own text, case- and space-insensitively', () => {
    const label = { id: 'user-1', name: 'Morning Count', target: 33 };
    expect(matchesQuery(label, '  morning ')).toBe(true);
    expect(matchesQuery(label, 'COUNT')).toBe(true);
    expect(matchesQuery(label, '')).toBe(true);
    expect(matchesQuery(label, 'evening')).toBe(false);
  });
});
