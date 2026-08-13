/**
 * The filesystem seam for prepared recitation audio.
 *
 * ── Why this is a port and not a direct `expo-file-system` call ─────────────
 * Two reasons, and the second is the one that matters. The first is ordinary: Jest has no native
 * filesystem, so a preparation engine that imported `expo-file-system` could not be tested at all.
 *
 * The second is that this is the **only** part of NoorLife that writes bytes fetched from a
 * third-party CDN to the device. Everything about how that is done safely — download to a temporary
 * sibling, validate before use, promote atomically, never leave a partial file where a player could
 * find it — is a property of the implementation behind this interface, and having exactly one
 * interface means there is exactly one implementation to review.
 *
 * ── The audio URL never becomes a filename ──────────────────────────────────
 * `name` is supplied by the caller and derived from identifiers the app already owns — reciter,
 * surah, ayah. Deriving it from the URL instead would put a vendor host and a signed path fragment
 * into the filesystem, into any directory listing, and into any crash report that enumerated one.
 * See `audioFileName`.
 */

/** A file that exists on disk and has been through validation. */
export type StoredAudioFile = {
  /** The caller's own name, e.g. `r3-s2-a1.mp3`. Never derived from a URL. */
  readonly name: string;
  /** A `file://` URI the platform player can open. */
  readonly uri: string;
  readonly bytes: number;
  /** Epoch milliseconds the file was promoted. Drives the licence-ceiling expiry. */
  readonly storedAt: number;
};

export type AudioDownloadRequest = {
  /** The allow-listed HTTPS URL the edge function supplied. Never logged, never stored. */
  readonly url: string;
  readonly name: string;
  /** Aborting cancels the transfer and removes whatever partial file it produced. */
  readonly signal: AbortSignal;
  /**
   * Fraction complete, or `null` when the server sent no `Content-Length`.
   *
   * Nullable rather than defaulted to zero: a progress bar drawn from a fabricated zero claims a
   * measurement the download did not make, which is the same defect class as a duration of zero
   * meaning "not yet known".
   */
  readonly onProgress?: (fraction: number | null) => void;
};

export type AudioStore = {
  /** Every promoted file currently on disk. Excludes partials, which are never listed. */
  list(): readonly StoredAudioFile[];
  /** One file, or `null` when it is absent, unreadable or zero-length. */
  read(name: string): StoredAudioFile | null;
  /** Best-effort. A file that cannot be removed is not an error the reader can act on. */
  remove(name: string): void;
  /**
   * Downloads, validates and promotes.
   *
   * Rejects on a transport failure, on an aborted signal, and on a file that does not validate —
   * and in every one of those cases leaves nothing behind that a later read could mistake for a
   * complete file.
   */
  download(request: AudioDownloadRequest): Promise<StoredAudioFile>;
  /** Removes every partial left by a download this process did not finish. */
  sweepIncomplete(): void;
  /** Free space in bytes, or `null` where the platform does not report it. */
  availableBytes(): number | null;
};

/**
 * The smallest thing that could be a recitation of an ayah.
 *
 * A truncated transfer that produced a few hundred bytes is a file the platform player will open,
 * fail to decode, and report as a playback error against a verse that is perfectly fine — so the
 * size floor is checked before the header rather than being left to the decoder. The shortest ayah
 * in the Qur'an recited at any bitrate is far above this.
 */
export const MIN_AUDIO_BYTES = 2048;

/**
 * Whether the first bytes of a file are plausibly the audio this app asked for.
 *
 * ── What this check is, and what it deliberately is not ─────────────────────
 * It is a guard against a **truncated or substituted body** — a captive-portal HTML page, a JSON
 * error document, a transfer that stopped after the first packet. All three download with a `200`
 * and all three would be handed to the player as a recitation.
 *
 * It is *not* a decoder and does not claim to be. A file that passes here can still fail to play,
 * and the player's own failure state handles that. The purpose is to catch the cases where
 * something that is obviously not audio would otherwise be cached and replayed for a week.
 *
 * The two accepted forms are the two the vendor's CDN serves: an ID3v2 tag, and a bare MPEG frame
 * header. `0xFF` followed by the top three bits of the next byte set is the MPEG sync word.
 */
export function isPlausibleAudio(header: Uint8Array, bytes: number): boolean {
  if (bytes < MIN_AUDIO_BYTES || header.length < 3) {
    return false;
  }
  // `ID3` — an ID3v2 tag, which is how most of the catalogue's files begin.
  if (header[0] === 0x49 && header[1] === 0x44 && header[2] === 0x33) {
    return true;
  }
  // An MPEG audio frame sync: eleven set bits across the first two bytes.
  const first = header[0] ?? 0;
  const second = header[1] ?? 0;
  return first === 0xff && (second & 0xe0) === 0xe0;
}

/**
 * The on-disk name for one ayah's recitation.
 *
 * ── Every component is an identifier this app already holds ─────────────────
 * Nothing from the URL reaches the filename, which is what keeps the vendor's host and path out of
 * the filesystem. The reciter id is sanitised rather than trusted: it is a stored preference, so a
 * value written by an older build or a hand-edited store could otherwise contain a path separator
 * and escape the audio directory.
 */
export function audioFileName(reciterId: string, surah: number, ayah: number): string {
  const reciter = reciterId.replace(/[^A-Za-z0-9]/g, '');
  return `r${reciter}-s${surah}-a${ayah}.mp3`;
}

/** The partial a download writes to before it is validated and promoted. */
export function partialFileName(name: string): string {
  return `${name}.part`;
}

/** Whether a directory entry is a partial rather than a promoted file. */
export function isPartialName(name: string): boolean {
  return name.endsWith('.part');
}

/**
 * The surah and reciter a promoted file belongs to, or `null` when the name is not one of ours.
 *
 * Used by eviction and by the download index to decide whether a file is pinned. Parsing the name
 * rather than keeping a parallel index is deliberate: the filesystem is the only thing that knows
 * what actually exists, and an index that disagreed with it would be a second source of truth about
 * bytes on disk.
 */
export function parseAudioFileName(
  name: string,
): { readonly reciterId: string; readonly surah: number; readonly ayah: number } | null {
  const match = /^r([A-Za-z0-9]+)-s(\d+)-a(\d+)\.mp3$/.exec(name);
  if (match === null) {
    return null;
  }
  const [, reciterId, surah, ayah] = match;
  if (reciterId === undefined || surah === undefined || ayah === undefined) {
    return null;
  }
  return { reciterId, surah: Number(surah), ayah: Number(ayah) };
}
