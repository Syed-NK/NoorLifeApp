import { Stack } from 'expo-router';

/** Subscription navigator (workflow §14). */
export default function Layout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
