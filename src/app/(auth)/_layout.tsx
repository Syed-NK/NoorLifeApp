import { Stack } from 'expo-router';

/**
 * Authentication navigator (workflow §4).
 *
 * `gestureEnabled` is iOS-only in react-native-screens; see the onboarding layout for why the
 * entry screens carry `EntrySwipeBack` as well.
 */
export default function Layout() {
  return <Stack screenOptions={{ headerShown: false, gestureEnabled: true }} />;
}
