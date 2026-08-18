import { RECITATION_RATES, type RecitationTransport } from '../../hooks/use-recitation-player';
import { QuranAudioPlayer, type QuranPlaybackState } from './quran-audio-player';

/**
 * The adapter between the recitation state machine and the player that draws it.
 *
 * ── Why this is a separate file from `QuranAudioPlayer` ─────────────────────
 * Because the two answer different questions and only one of them is about pixels. The player takes
 * plain values, so it can be rendered at a fixed viewport in every state without an audio pipeline
 * behind it, and this file can be reasoned about without reading a line of layout.
 *
 * ── Why it no longer resolves a state ───────────────────────────────────────
 * It used to, from four independent booleans and two nullable fields, by precedence — and every
 * combination nobody enumerated fell through to `idle`, which read "Ready to play" over a surah with
 * no audio on the device. The resolution now happens in `useRecitationPlayer`, where the queue and
 * the manifest actually are, and the two unions are one-to-one. That is the whole of `toPlayerState`
 * below: a rename, not a decision. A decision taken here would be a second opinion about a fact the
 * transport already knows.
 */
export function ReaderPlayer({
  transport,
  surahName,
  ayah,
  reciterName,
  totalAyat,
  onOpenReciters,
  onManageOfflineAudio,
}: {
  readonly transport: RecitationTransport;
  readonly surahName: string;
  /**
   * The verse the **reader** is about — a deep link's target, or the page's first verse.
   *
   * ── Why this wins over a fallback inside the transport ──────────────────────
   * The player is mounted from the moment the reader has a page, which includes the case where the
   * surah is not downloaded and the case where a deep link opened at a verse the transport has not
   * been pointed at yet. It still has to say which verse it is pointed at, and the reader is the only
   * thing that knows.
   *
   * The transport's *explicit* position wins, because a loaded or deliberately selected verse is a
   * stronger statement than the route's. Its `first downloaded verse` fallback does not — that is a
   * drawing convenience, and letting it win is how `reader/2?ayah=255` came to caption itself
   * "Aya 1" while the column was on 255.
   */
  readonly ayah: number;
  /** `null` until the reciter catalogue resolves. Never replaced with a guessed name. */
  readonly reciterName: string | null;
  readonly totalAyat: number;
  readonly onOpenReciters: () => void;
  readonly onManageOfflineAudio: () => void;
}) {
  return (
    <QuranAudioPlayer
      surahName={surahName}
      ayah={transport.pointedAyah ?? ayah}
      totalAyat={transport.totalAyat ?? totalAyat}
      reciterName={reciterName}
      state={toPlayerState(transport.phase)}
      positionSeconds={transport.elapsedSeconds}
      durationSeconds={transport.durationSeconds}
      rate={transport.rate}
      rates={RECITATION_RATES}
      rateSupported={transport.speedSupported}
      hasPrevious={transport.hasPrevious}
      hasNext={transport.hasNext}
      downloadedAyat={transport.downloadedAyat}
      missingAyah={transport.missingAyah}
      /*
        Forwarded unconditionally. The adapter used to guard this with `if (focus !== null)`, which
        made a press on a surah with no audio do nothing at all — no sound, no message, no change.
        The transport answers that case itself now; see `requestPlay`.
      */
      onTogglePlay={transport.requestPlay}
      onPrevious={transport.previous}
      onNext={transport.next}
      onSeek={transport.seekTo}
      onChangeRate={transport.setRate}
      onRetry={transport.retry}
      onOpenReciters={onOpenReciters}
      onManageOfflineAudio={onManageOfflineAudio}
    />
  );
}

/**
 * The transport's phase, as the player's state.
 *
 * One-to-one, and exhaustive over both unions so that adding a phase without deciding how it is drawn
 * is a build failure rather than a screen that silently renders the wrong thing.
 */
function toPlayerState(phase: RecitationTransport['phase']): QuranPlaybackState {
  switch (phase) {
    case 'loading':
      return 'loading';
    case 'not-downloaded':
      return 'not-downloaded';
    case 'idle':
      return 'idle';
    case 'starting':
      return 'starting';
    case 'playing':
      return 'playing';
    case 'paused':
      return 'paused';
    case 'buffering':
      return 'buffering';
    case 'completed':
      return 'completed';
    case 'missing-ayah':
      return 'missing-ayah';
    case 'failed':
      return 'failed';
  }
}
