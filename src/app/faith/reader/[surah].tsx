import { ReaderScreen } from '@features/faith/screens/reader-screen';

/**
 * Faith → Reader, for one surah.
 *
 * The surah number is the path segment and an optional `ayah` query parameter scrolls to a verse.
 * Both are read by the screen through `useLocalSearchParams`, so this file stays a plain mount.
 */
export default function Screen() {
  return <ReaderScreen />;
}
