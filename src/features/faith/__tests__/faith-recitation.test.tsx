import { cleanup, configure, fireEvent, waitFor } from '@testing-library/react-native';

import { warmUpFirstMount } from '@/test-support/mock-latency-timers';
import { playFromAyah, READER_RECITATIONS, renderReader } from '@/test-support/faith-reader';

import { mockAudio, setRouteParams } from '../../../../jest.setup';

/**
 * Recitation playback in the reader.
 *
 * ── The rule every case here defends ────────────────────────────────────────
 * **There is exactly one playback controller, and it reports only what the player reports.** The
 * reader used to draw a play button on every one of a surah's ayat — 286 controls driving one
 * transport — and before that the Faith home carried a fully-labelled, fully-accessible play button
 * that toggled a boolean and streamed nothing. These assert the replacement is neither.
 *
 * ── And what is never claimed about it ──────────────────────────────────────
 * What plays is Arabic recitation. The approved API provides no translated narration, so nothing on
 * screen may describe playback as a translation — the last case checks the labels for it.
 */
/** Real timers and a raised budget, for the reason `faith-recitation-advance` records. */
configure({ asyncUtilTimeout: 3000 });
jest.setTimeout(15000);

warmUpFirstMount(() => renderReader({ recitations: READER_RECITATIONS }).then(({ view }) => view));

describe('there is one playback controller and it is the docked player', () => {
  it('draws no play button on any ayah', async () => {
    const { view } = await renderReader({ recitations: READER_RECITATIONS });
    await view.findByTestId('faith-reader-ayah-1-1');

    /**
     * The whole point of the change, asserted at the strongest available granularity: not "fewer
     * play buttons", but none. `faith-reader-play-*` was the old per-ayah control's test id, so a
     * regression that restored it fails here rather than being noticed in review.
     */
    expect(view.queryByTestId('faith-reader-play-1-1')).toBeNull();
    expect(view.queryByTestId('faith-reader-play-1-2')).toBeNull();
    // Exactly one control in the whole reader is labelled as playing a recitation, and it is the
    // docked player's. Zero would now be wrong: the player is on screen from the moment the surah
    // loads, so "none" would mean the transport itself had gone missing.
    expect(view.queryAllByLabelText(/^Play recitation of/)).toHaveLength(1);
  });

  it('offers exactly one transport once a verse is playing', async () => {
    const { view } = await renderReader({ recitations: READER_RECITATIONS });
    await playFromAyah(view, 1);

    expect(await view.findByTestId('faith-reader-player')).toBeTruthy();
    // `getAllBy` rather than `getBy`, so "one" is asserted rather than "at least one".
    expect(view.getAllByTestId('faith-reader-player-toggle')).toHaveLength(1);
  });

  it('draws the player before anything is playing, complete and idle', async () => {
    const { view } = await renderReader({ recitations: READER_RECITATIONS });
    await view.findByTestId('faith-reader-ayah-1-1');

    /**
     * The inversion of what this case used to assert, and the reason is the correction brief: the
     * transport is not a consequence of playback, it is the surface playback is started from. It
     * carries its whole control set here, with nothing loaded.
     */
    expect(await view.findByTestId('faith-reader-player')).toBeTruthy();
    expect(view.getByTestId('faith-reader-player-toggle')).toBeTruthy();
    expect(view.getByTestId('faith-reader-player-seek')).toBeTruthy();
  });

  it('says why Play is unavailable on a verse this reciter has not recorded', async () => {
    const { view } = await renderReader({ recitations: READER_RECITATIONS });
    /*
      Al-Fatihah's fixture carries more verses than the two with audio. The sheet is the same seven
      rows on every verse — a list that changed length between verses would be a difference the user
      cannot account for — so Play is present and *disabled*, with the reason stated in words rather
      than left as a control that silently does nothing.
    */
    fireEvent.press(await view.findByTestId('faith-reader-ayah-1-5'));

    const play = await view.findByTestId('faith-reader-action-play');
    expect(play.props.accessibilityState).toMatchObject({ disabled: true });
    expect(await view.findByText(/no recording of this aya/i)).toBeTruthy();

    // And the six actions that do not need audio are all still offered.
    for (const action of ['read', 'bookmark', 'note', 'playlist', 'ask-noor-ai', 'share']) {
      expect(view.getByTestId(`faith-reader-action-${action}`)).toBeTruthy();
    }
  });

  it('draws a disabled transport, not a hopeful one, when the repository has no audio', async () => {
    setRouteParams({ surah: '1' });
    // The fixture repository answers `empty`, because shipping a placeholder recitation of the
    // Qur'an is not something NoorLife does at any fidelity.
    const { view } = await renderReader();
    await view.findByTestId('faith-reader-header-label');

    expect(await view.findByTestId('faith-reader-player')).toBeTruthy();
    expect(view.getByTestId('faith-reader-player-toggle').props.accessibilityState).toMatchObject({
      disabled: true,
    });
  });
});

describe('the transport', () => {
  it('plays the verse that was chosen, from a local file rather than the network', async () => {
    const { view } = await renderReader({ recitations: READER_RECITATIONS });
    await playFromAyah(view, 2);

    await waitFor(() => expect(mockAudio.currentUri()).not.toBeNull());
    /**
     * The source is a `file://` URI, not the CDN address.
     *
     * This is the assertion that the preparation layer is actually in the path: before it, the
     * player was pointed straight at `https://verses.quran.foundation/...` and every ayah began with
     * a network open. A regression that removed preparation would fail here rather than merely
     * sounding worse.
     */
    expect(mockAudio.currentUri()).toMatch(/^file:\/\//);
    expect(mockAudio.currentUri()).toContain('r3-s1-a2.mp3');
  });

  it('names the reciter while playing', async () => {
    const { view } = await renderReader({ recitations: READER_RECITATIONS });
    await playFromAyah(view, 1);

    const reciter = await view.findByTestId('faith-reader-player-reciter');
    // The requirement is that the reciter is visible during playback, and preferences two taps away
    // does not satisfy it.
    expect(String(reciter.props.children)).toContain('Abdur-Rahman as-Sudais');
  });

  it('advances to the next verse and back', async () => {
    const { view } = await renderReader({ recitations: READER_RECITATIONS });
    await playFromAyah(view, 1);
    await waitFor(() => expect(mockAudio.currentUri()).toContain('r3-s1-a1.mp3'));

    fireEvent.press(await view.findByTestId('faith-reader-player-next'));
    await waitFor(() => expect(mockAudio.currentUri()).toContain('r3-s1-a2.mp3'));

    fireEvent.press(await view.findByTestId('faith-reader-player-previous'));
    await waitFor(() => expect(mockAudio.currentUri()).toContain('r3-s1-a1.mp3'));
  });

  it('disables next at the end and previous at the start', async () => {
    const { view } = await renderReader({ recitations: READER_RECITATIONS });
    await playFromAyah(view, 1);

    expect(
      (await view.findByTestId('faith-reader-player-previous')).props.accessibilityState,
    ).toMatchObject({ disabled: true });

    fireEvent.press(view.getByTestId('faith-reader-player-next'));

    await waitFor(() =>
      expect(view.getByTestId('faith-reader-player-next').props.accessibilityState).toMatchObject({
        disabled: true,
      }),
    );
  });

  it('pauses on the toggle and keeps the player on screen', async () => {
    const { view } = await renderReader({ recitations: READER_RECITATIONS });
    await playFromAyah(view, 1);
    await waitFor(() => expect(mockAudio.currentUri()).not.toBeNull());
    mockAudio.setStatus({ isLoaded: true, playing: true });

    fireEvent.press(await view.findByTestId('faith-reader-player-toggle'));

    expect(mockAudio.player.pause).toHaveBeenCalled();
    /**
     * The player stays. Pause is not stop: the verse is still loaded, still named and still where
     * the user left it, and the same control resumes it. The transport is released when the reader
     * unmounts, which is the case below.
     */
    expect(view.getByTestId('faith-reader-player')).toBeTruthy();
  });

  it('releases the player at the end of the loaded page', async () => {
    const { view } = await renderReader({ recitations: READER_RECITATIONS });
    await playFromAyah(view, 2);
    await waitFor(() => expect(mockAudio.currentUri()).not.toBeNull());

    // Verse 2 is the last with audio in this fixture. A finished last verse stops the transport,
    // which releases the session rather than leaving a finished player holding it open.
    mockAudio.setStatus({ didJustFinish: true, isLoaded: true, playing: false });

    await waitFor(() => expect(mockAudio.currentUri()).toBeNull());
    expect(mockAudio.player.pause).toHaveBeenCalled();
  });

  it('offers no control for a feature that does not exist', async () => {
    const { view } = await renderReader({ recitations: READER_RECITATIONS });
    await playFromAyah(view, 1);
    await view.findByTestId('faith-reader-player');

    /**
     * Repeat is genuinely not implemented, so it is genuinely not drawn. Speed *is* implemented and
     * bounded, which is why it is not in this list — the rule is "no control for a feature that does
     * not exist", not "no controls".
     */
    expect(view.queryByText(/repeat/i)).toBeNull();
    expect(view.queryByText(/2×|0\.5×/)).toBeNull();
  });
});

describe('the states come from the player, not from the tap', () => {
  it('reports preparing before the file exists, and not playing', async () => {
    const { view } = await renderReader({ recitations: READER_RECITATIONS });
    await playFromAyah(view, 1);

    // The tap alone must not flip the caption to playing — that is what the old fixture control did.
    const caption = await view.findByTestId('faith-reader-player-reciter');
    expect(String(caption.props.children)).not.toContain('Reciting');
  });

  it('announces buffering while the platform is buffering', async () => {
    const { view } = await renderReader({ recitations: READER_RECITATIONS });
    await playFromAyah(view, 1);
    await waitFor(() => expect(mockAudio.currentUri()).not.toBeNull());

    mockAudio.setStatus({ isBuffering: true, playing: false });

    await waitFor(() => expect(view.getByTestId('faith-reader-player-buffering')).toBeTruthy());
    expect(String(view.getByTestId('faith-reader-player-reciter').props.children)).toContain(
      'Buffering',
    );
  });

  it('announces reciting only when the player says it is playing', async () => {
    const { view } = await renderReader({ recitations: READER_RECITATIONS });
    await playFromAyah(view, 1);
    await waitFor(() => expect(mockAudio.currentUri()).not.toBeNull());

    /**
     * Read from the identity block's spoken label rather than from the reciter caption.
     *
     * The caption now carries the reciter's name and only the states no glyph expresses — a pause
     * icon already says "playing", and repeating it in words pushed the name off the line. What a
     * screen reader hears is unchanged, and it is the channel the requirement is actually about.
     */
    mockAudio.setStatus({ playing: true, isBuffering: false, isLoaded: true });

    await waitFor(() =>
      expect(
        String(view.getByTestId('faith-reader-player-status').props.accessibilityLabel),
      ).toMatch(/^Reciting\./),
    );
  });

  it('offers a retry when the load failed', async () => {
    const { view } = await renderReader({ recitations: READER_RECITATIONS });
    await playFromAyah(view, 1);
    await waitFor(() => expect(mockAudio.currentUri()).not.toBeNull());

    mockAudio.setStatus({ isLoaded: false, isBuffering: false, playing: false });

    expect(await view.findByTestId('faith-reader-player-retry')).toBeTruthy();
  });
});

describe('what plays is never called a translation', () => {
  it('describes playback as recitation in every label', async () => {
    const { view } = await renderReader({ recitations: READER_RECITATIONS });
    await playFromAyah(view, 1);
    await view.findByTestId('faith-reader-player');

    for (const node of view.getAllByLabelText(/./)) {
      const spoken = String(node.props.accessibilityLabel ?? '');
      if (!spoken.toLowerCase().includes('recit')) {
        continue;
      }
      expect(spoken).not.toMatch(/translat/i);
      expect(spoken).not.toMatch(/narration|dubbed|voice-over/i);
    }

    expect(view.getByTestId('faith-reader-player-toggle').props.accessibilityLabel).toMatch(
      /recitation/i,
    );
  });

  it('stops playback when the reader unmounts, by releasing rather than pausing', async () => {
    /**
     * ── This assertion was inverted once, and that is how a crash shipped ──────
     * It used to require `pause` to have been called on unmount. That is exactly the call that threw
     * `ERR_USING_RELEASED_SHARED_OBJECT` on device: `useAudioPlayer` releases the player in a cleanup
     * registered where the hook is called, React runs cleanups in declaration order, so any cleanup
     * this app registers afterwards runs against a freed object.
     *
     * What replaces it is the invariant the SDK actually offers: the hook owns the lifetime, release
     * stops playback, and the app touches nothing on the way out.
     */
    const { view } = await renderReader({ recitations: READER_RECITATIONS });
    await playFromAyah(view, 1);
    await waitFor(() => expect(mockAudio.currentUri()).not.toBeNull());

    const player = mockAudio.currentPlayer();
    expect(player).not.toBeNull();
    expect(player?.__isReleased()).toBe(false);
    const releasesBefore = mockAudio.releaseCount();
    mockAudio.player.pause.mockClear();

    // `cleanup` unmounts the tree and runs effect teardown, which is the path a navigation away
    // takes.
    await cleanup();

    expect(player?.__isReleased()).toBe(true);
    // Exactly one release: not zero, which would leave the audio session held, and not two.
    expect(mockAudio.releaseCount()).toBe(releasesBefore + 1);
    expect(mockAudio.player.pause).not.toHaveBeenCalled();
  });
});
