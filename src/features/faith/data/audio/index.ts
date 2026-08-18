export {
  audioFileName,
  isPartialName,
  isPlausibleAudio,
  MIN_AUDIO_BYTES,
  parseAudioFileName,
  partialFileName,
  type AudioDownloadRequest,
  type AudioStore,
  type StoredAudioFile,
} from './audio-store.port';
export { audioDirectoryFor, createExpoAudioStore, type AudioStoreKind } from './expo-audio-store';
export { createExpoManifestFile, offlineManifestDirectory } from './expo-manifest-file';
export {
  createOfflineManifestStore,
  DEFAULT_FLUSH_EVERY,
  type ManifestFilePort,
  type OfflineManifestStore,
} from './offline-manifest.store';
export {
  createOfflineDownloadService,
  DOWNLOAD_CONCURRENCY,
  type BoundGeneration,
  type GenerationSource,
  type OfflineDownloadService,
  type OfflineFailure,
  type OfflineSnapshot,
  type RecitationUrlResolver,
} from './offline-download.service';
export { createGenerationSource, createRepositoryUrlResolver } from './offline-adapters';
export {
  estimateSize,
  storageDecisionFor,
  STORAGE_SAFETY_MARGIN_BYTES,
  UNKNOWN_ESTIMATE_FLOOR_BYTES,
  upperBoundBytes,
  type EstimateBasis,
  type SizeEstimate,
  type StorageDecision,
} from './offline-estimate';
export {
  ayatBySurah,
  pendingWork,
  planReconciliation,
  queuedRowFor,
  type PublishedRow,
  type ReconciliationPlan,
} from './offline-reconcile';
export {
  manifestIsAuthoritative,
  migrateLegacyAudio,
  type AdoptionRejection,
  type MigrationOutcome,
} from './offline-migration';
export {
  buildLocalPlaylist,
  hasNextTrack,
  hasPreviousTrack,
  indexOfAyah,
  isLastTrack,
  MAX_PLAYLIST_TRACKS,
  parsePlaylistTrackName,
  playlistTrackName,
  sameTracks,
  trackAt,
  type PlaylistBuild,
  type PlaylistBuildFailure,
  type PlaylistTrack,
} from './recitation-playlist';
