import type { SurahDownloadState } from '../../data/audio';
import { RECITATION_RATES, type RecitationTransport } from '../../hooks/use-recitation-player';
import { QuranAudioPlayer, type QuranPlaybackState } from './quran-audio-player';

/**
 * The adapter between the recitation state machine and the player that draws it.
 *
 * ── Why this is a separate file from `QuranAudioPlayer` ─────────────────────
 * Because the two answer different questions and only one of them is about pixels. This file
 * resolves a transport — four independent booleans, a nullable selection, a nullable duration —
 * into the single closed `QuranPlaybackState` the player renders, and it is the only place that
 * resolution happens. The player takes plain values, so it can be rendered at a fixed viewport in
 * every state without an audio pipeline behind it, and this file can be reasoned about without
 * reading a line of layout.
 *
 * It owns no selection rules either: which verse is current, what follows it and what may be
 * played are all `useRecitationPlayer`'s, reached here through the transport it returns.
 */
export function ReaderPlayer({
  transport,
  surahName,
  ayah,
  reciterName,
  totalAyat,
  download,
  onDownloadSurah,
  onCancelDownload,
  onOpenReciters,
}: {
  readonly transport: RecitationTransport;
  readonly surahName: string;
  /**
   * The verse to name when the transport has none — a surah with no recitation at all.
   *
   * The player is mounted from the moment the reader has a page, which includes the case where
   * this reciter published nothing for this surah. It still has to say which verse it is pointed
   * at, and the reader is the only thing that knows.
   */
  readonly ayah: number;
  /** `null` until the reciter catalogue resolves. Never replaced with a guessed name. */
  readonly reciterName: string | null;
  readonly totalAyat: number;
  readonly download: SurahDownloadState;
  readonly onDownloadSurah: () => void;
  readonly onCancelDownload: () => void;
  readonly onOpenReciters: () => void;
}) {
  const focus = transport.focus;

  return (
    <QuranAudioPlayer
      surahName={surahName}
      ayah={focus?.ayah ?? ayah}
      totalAyat={totalAyat}
      reciterName={reciterName}
      state={resolveState(transport)}
      positionSeconds={transport.elapsedSeconds}
      durationSeconds={transport.durationSeconds}
      prepareProgress={transport.prepareProgress}
      rate={transport.rate}
      rates={RECITATION_RATES}
      rateSupported={transport.speedSupported}
      download={download}
      hasPrevious={transport.hasPrevious}
      hasNext={transport.hasNext}
      failure={transport.preparationFailure}
      onTogglePlay={() => {
        if (focus !== null) {
          transport.toggle(focus);
        }
      }}
      onPrevious={transport.previous}
      onNext={transport.next}
      onSeek={transport.seekTo}
      onChangeRate={transport.setRate}
      onDownload={onDownloadSurah}
      onCancelDownload={onCancelDownload}
      onRetry={transport.retry}
      onOpenReciters={onOpenReciters}
    />
  );
}

/**
 * The transport's flags, resolved into the one state the player draws.
 *
 * ── The order of these branches is the whole content of this function ───────
 * More than one flag is true at once for most of a verse's life — a verse that failed is also not
 * playing, a verse being prepared is also not loaded — so "which state is this" is answered by
 * precedence, not by a lookup. Failure first, because a player that reported "paused" over a verse
 * that could not be fetched would hide the only actionable thing on the panel. `offline` is split
 * out of failure because it is the one failure whose remedy is not "try again".
 */
function resolveState(transport: RecitationTransport): QuranPlaybackState {
  if (transport.focus === null) {
    return 'unavailable';
  }
  if (transport.failed) {
    return transport.preparationFailure === 'offline' ? 'offline' : 'failed';
  }
  if (transport.preparing) {
    return 'preparing';
  }
  if (transport.buffering) {
    return 'buffering';
  }
  if (transport.playing) {
    return 'playing';
  }
  if (transport.completed) {
    return 'completed';
  }
  /*
    `paused` and `idle` are distinguished by whether a verse is loaded at all, not by a flag. A
    transport with no selection has never been started — or has been stopped — and calling that
    "paused" would offer a resume that would in fact be a start.
  */
  return transport.current === null ? 'idle' : 'paused';
}
