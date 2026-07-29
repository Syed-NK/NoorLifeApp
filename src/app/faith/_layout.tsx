import { Stack } from 'expo-router';

/** faith module navigator. The module owns its own stack (workflow §3.2). */
export default function Layout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
