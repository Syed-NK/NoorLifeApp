import { Stack } from 'expo-router';

/**
 * Onboarding navigator (workflow §2).
 *
 * `gestureEnabled` is the native edge-swipe dismissal, which react-native-screens supports on iOS
 * only. It is set here so iOS gets the platform-native gesture for free; Android ignores it, which
 * is why the entry screens also carry `EntrySwipeBack` — a PanResponder swipe that works on both.
 */
export default function Layout() {
  return <Stack screenOptions={{ headerShown: false, gestureEnabled: true }} />;
}
