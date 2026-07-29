import { Stack } from 'expo-router';

/** Authentication navigator (workflow §4). */
export default function Layout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
