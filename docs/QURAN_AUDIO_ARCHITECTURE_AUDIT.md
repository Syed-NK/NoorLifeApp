# Qur'an audio — Phase 0 audit of the architecture being replaced

**Date:** 2026-08-15
**Commit audited:** `0ef5ab2`
**Purpose:** record what exists before it is changed, and name the mechanism that produces the
audible pause between ayat.

---

## 1. The path a recitation takes today

| Stage | Where | What it does |
|---|---|---|
| URL request | `quran-foundation.repository.ts` → `listRecitations(surah, reciterId, page)` | Calls the Edge operation `list_verse_recitations`. Returns `AyahRecitation[]` — `surah`, `ayah`, `reciterId`, absolute `https:` `url`. |
| Edge boundary | `supabase/functions/quran-content/` | Holds the Quran Foundation credentials. Closed allow-list of eight operations. The client never talks to Quran Foundation. |
| Preparation | `recitation-preparation.ts` | Downloads one ayah at a time to a private cache file and hands back a `file://` URI. `PREFETCH_AHEAD = 3`, `MAX_PREPARED_BYTES = 96 MB`. |
| Filesystem | `expo-audio-store.ts` | `Paths.cache/faith-recitations`. Writes `<name>.part`, validates, promotes atomically. `audioFileName` = `r<reciter>-s<surah>-a<ayah>.mp3`. |
| Deliberate downloads | `recitation-audio.ts` + `faith-audio-downloads.ts` | A per-surah download with `DOWNLOAD_CONCURRENCY = 3`, recorded in an AsyncStorage index of *decisions* (no URLs). Pins those files against prefetch eviction. |
| Expiry | `quran-foundation.contract.ts` → `MAX_CACHE_AGE_MS = 7 days` | Read-time expiry applied to every reciter including resource 3. |
| Playback | `use-recitation-player.ts` | **One** `AudioPlayer`. See §2. |
| Download UI | Docked player control + Reciter screen Downloads panel | Both are being removed from the player in Phase 1. |
| Removal UI | Player completed-state control, Downloads panel per-surah and bulk | Verified working on device 2026-08-15. |
| Selected reciter | `faith-preferences.ts` → `reciterId`, default `'3'` | `DEFAULT_RECITER_ID = '3'` (Abdur-Rahman as-Sudais), `reciterChosenByUser` guards it. |
| Media session | `use-recitation-player.ts` → `setAudioModeAsync({ shouldPlayInBackground: false })` | Background playback is currently **off**. Android still creates a media session per player instance. |

## 2. The mechanism that produces the pause

`use-recitation-player.ts` holds a single player whose **source is replaced per ayah**:

```ts
const uri = selection?.uri ?? null;
const player = useAudioPlayer(uri === null ? null : { uri });
```

`useAudioPlayer` is `useReleasingSharedObject` keyed on `JSON.stringify(source)`, so a new ayah
means a **new native player object**. The sequence at every boundary is therefore:

1. the current ayah reports `didJustFinish`;
2. JavaScript picks the next recitation and sets `selection`;
3. if its file is not prepared, `preparation.prepare()` runs — a network download;
4. the new `uri` changes the memo key, so React releases the old native player and constructs a new one;
5. the new player loads the file;
6. playback resumes.

Steps 2–5 are all **application-added** time. Step 3 is unbounded when the file is not local.
`PREFETCH_AHEAD = 3` hides it when the reader is ahead of the listener and does not when it is not.

**This is the defect.** It is not a codec or encoding problem, and it is not fixed by prefetching
harder: even fully prepared, a source replacement costs a native object teardown, construction and
load between two ayat.

## 3. Quran Foundation identifiers in use

- Ayah recitation resource **3** (Abdur-Rahman as-Sudais), via `list_verse_recitations`.
- `SUDAIS_RESOURCE_ID = '3'` and the required attribution live in `recitation-attribution.ts`.
- **No chapter-reciter endpoint is used anywhere.** Chapter reciters are a separate catalogue with
  separate ids, and substituting one for resource 3 would be a different licence — asserted by test.

## 4. Measuring the gap honestly

The brief forbids inferring silence from the interval between player labels, and that prohibition is
right: a label changes when React commits, which is neither when audio stopped nor when it resumed.

Four causes have to be told apart, and only the last three are NoorLife's:

| Cause | How it is distinguished |
|---|---|
| Silence encoded in the provider's file | Present in the decoded PCM of the file itself; identical on every playback and on any player. |
| Player queue transition | Native; observable as the interval between ExoPlayer media-item transitions with no JS in between. |
| Network / download wait | A request is in flight at the boundary. Observable as a non-zero network count during playback. |
| JavaScript source replacement | A new native player object is constructed. Observable as a change of player identity at the boundary. |

`recitation-transition-probe.ts` is the seam added for this: it records one entry per boundary
carrying the wall-clock instant, whether a source replacement occurred, whether a transfer was in
flight, and the reported playback position either side. It is what the before/after numbers in the
final report are taken from, and it is deliberately not wired to any user-visible surface.

## 5. What is *not* changing in this work

- The seven-day ceiling for every reciter other than resource 3 — see
  `QURAN_FOUNDATION_AUDIO_PERMISSION.md` §8.
- The Edge allow-list, unless Content Sync requires an addition, which is completed locally and
  **not deployed**.
- Private-storage-only, no share, no export, no MediaStore.
