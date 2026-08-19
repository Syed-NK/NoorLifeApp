import { useLocalSearchParams } from 'expo-router';

import { DuaCategoryScreen } from '@features/faith/screens/dua-category-screen';

/**
 * Faith → Duas → one category.
 *
 * The parameter is passed through as-is rather than narrowed here: `duaCategoryById` is the one
 * place that decides what a category id is, and a second opinion in a route file would be a second
 * place to keep in step.
 */
export default function Screen() {
  const { category } = useLocalSearchParams<{ category?: string }>();
  return <DuaCategoryScreen categoryId={category ?? ''} />;
}
