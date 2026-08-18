/**
 * The GeoNames credit, as one string.
 *
 * ── Why a constant rather than a read from the asset ────────────────────────
 * The catalogue carries its own `meta.licence.attribution`, and the preview and the content-
 * information screen both read it from there — correctly, because both are already loading the
 * catalogue for something else.
 *
 * The Prayer Location card is not. It renders the credit whenever city mode is active, and loading
 * 2.19 MB to display one line of text would put the whole catalogue parse on the path of a screen
 * that may never be searched. So the string is a constant here.
 *
 * ── What stops the two copies drifting ──────────────────────────────────────
 * A test, not care. `faith-location-defaults-and-lookup.test.ts` reads the shipped asset and asserts
 * this string is byte-identical to the attribution inside it. A re-import that changed the wording
 * would fail that assertion rather than leaving a screen quietly crediting GeoNames under terms the
 * data no longer states — which is a licence breach that looks exactly like compliance.
 */
export const GEONAMES_ATTRIBUTION = 'City data © GeoNames, licensed under CC BY 4.0';

/**
 * What the app adds beside the credit: that the data is modified, and that it never leaves the phone.
 *
 * CC BY 4.0 requires an indication of changes, and NoorLife's asset genuinely is a derivative —
 * columns dropped, names normalised for searching, rows deduplicated and re-ordered. The second
 * sentence is not a licence obligation; it is the answer to the question a search field raises.
 */
export const GEONAMES_USAGE_NOTE =
  'Bundled with the app and searched on this device. The data has been modified from its original form.';
