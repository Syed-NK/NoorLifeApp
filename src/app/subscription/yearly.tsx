import { Redirect, type Href } from 'expo-router';

/**
 * Legacy route.
 *
 * Phase 5 replaced the "Yearly Plan Comparison" placeholder with the full Plan Comparison at
 * `/subscription/compare`. The route is kept as a redirect rather than deleted, because
 * `subscriptionRoutes.yearly` is part of the declared route contract and removing a declared
 * route is a change this phase was not asked to make.
 */
export default function Screen() {
  // Cast because expo-router generates its route union from the filesystem when Metro runs, so a
  // freshly added route is not yet in the type. The path is asserted by a navigation test instead.
  return <Redirect href={'/subscription/compare' as Href} />;
}
