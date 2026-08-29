import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, TextInput, View } from 'react-native';

import { ModuleButton, ModuleStatusBanner, ModuleText } from '@features/modules/components';
import { ModuleCard } from '@features/modules/components/module-card';
import { useModuleTheme } from '@features/modules/module-context';
import { moduleLayout, moduleNeutrals } from '@features/modules/module-tokens';
import { useModuleMetrics } from '@features/modules/use-module-metrics';

import { FaithRow, FaithRowGroup } from '../components/faith-list';
import { FaithScreen } from '../components/faith-screen';
import { hasData } from '../data/faith-result';
import { GEONAMES_ATTRIBUTION, GEONAMES_USAGE_NOTE } from '../data/location/city-attribution';
import { coordinateErrorMessage, parseCoordinateInput } from '../data/location/location-acceptance';
import {
  cityLabel,
  type CityChoice,
  type CityPreview,
  type PrayerLocation,
  type PrayerLocationMode,
  type PrayerTimesRepository,
} from '../data/prayer-times.repository';
import { useFaithRepositories } from '../di/faith-repository-context';
import { faithNavKeys } from '../faith-routes';
import { permissionAdvice, useLocationPermission } from '../hooks/use-location-permission';
import { usePrayerNotifications } from '../hooks/use-prayer-notifications';
import { minimumTouchTargetSize } from '@shared/utils/a11y';

/**
 * Prayer location — which coordinate every prayer time in NoorLife is calculated from.
 *
 * ── The three authorities, and why they are three ───────────────────────────
 * **Device** is the recommendation: it follows the user, needs no typing, and is the only one that
 * stays right when they travel. **A city** is what somebody picks when they have declined location,
 * are on a device whose GPS cannot be moved, or want the times of a place they are travelling to —
 * and it comes from the bundled GeoNames catalogue, so it is identified data with a country and a
 * region rather than a name somebody typed. **Coordinates** is the escape hatch for a place the
 * catalogue does not contain, and it is the only one whose label means nothing.
 *
 * The previous version of this screen had one and a half of those: a device switch and a coordinate
 * form, with a disabled row reading "city search will be available after a location provider is
 * approved". No provider was ever needed — the catalogue ships in the app.
 *
 * ── Nothing on this screen reaches the network ──────────────────────────────
 * Search is a scan of a bundled asset; the timezone in every preview is a lookup in the same offline
 * polygon set every prayer time already uses. There is no host to reach and no query that can leave
 * the device, which is a property of the modules beneath this one rather than a promise made here.
 *
 * ── Why a failed device attempt never clears what is saved ──────────────────
 * `switchToDeviceLocation` writes nothing unless it has already obtained a real fix, so a denied
 * permission or a cold GPS leaves the saved city exactly where it was — and the message names it,
 * because a user who saved Dubai needs to be told Dubai is still what they are looking at rather than
 * that something "failed".
 */

/** The two reads that describe the current location, and nothing else. */
async function readLocationState(prayerTimes: PrayerTimesRepository): Promise<{
  readonly active: PrayerLocation | null;
  readonly mode: PrayerLocationMode | null;
}> {
  const [resolved, mode] = await Promise.all([
    prayerTimes.resolveCurrentLocation(),
    prayerTimes.getActiveLocationMode(),
  ]);
  return { active: hasData(resolved) ? resolved.data : null, mode };
}

/** Which section of the screen is expanded. One at a time — see `onChoose`. */
type Panel = 'none' | 'city' | 'coordinates';

export function PrayerLocationScreen() {
  const { dp } = useModuleMetrics();
  const router = useRouter();
  const { prayerTimes } = useFaithRepositories();
  /*
    No reconciliation on mount. This screen only reschedules *after* it changes the location, and a
    reconciliation costs one prayer-time calculation per day of the horizon — seven, to render a form.
  */
  const notifications = usePrayerNotifications(false);

  const [active, setActive] = useState<PrayerLocation | null>(null);
  const [mode, setMode] = useState<PrayerLocationMode | null>(null);
  const [panel, setPanel] = useState<Panel>('none');

  /** True while a save, a device switch or a permission request is in flight. Blocks a second one. */
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const next = await readLocationState(prayerTimes);
    setActive(next.active);
    setMode(next.mode);
  }, [prayerTimes]);

  /*
    ── Why the mount read is an inline async function rather than a `load()` call ──
    Calling `load()` from the effect body sets state synchronously within it, which cascades a render
    — see `react-hooks/set-state-in-effect`. Awaiting the read inside the effect puts both writes
    after a genuine asynchronous boundary, and the cancellation flag stops a slow read writing to a
    screen the user has already left.
  */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const next = await readLocationState(prayerTimes);
      if (cancelled) {
        return;
      }
      setActive(next.active);
      setMode(next.mode);
    })();
    return () => {
      cancelled = true;
    };
  }, [prayerTimes]);

  /**
   * Opens one panel and closes the other, clearing whatever the last one was saying.
   *
   * Two open panels would put two Save buttons and two previews on screen at once, and the user would
   * have no way to tell which one a press was about to commit.
   */
  const onChoose = useCallback((next: Panel) => {
    setPanel((current) => (current === next ? 'none' : next));
    setError(null);
    setNotice(null);
  }, []);

  /**
   * Everything that has to happen after a location is committed, in order.
   *
   * ── The order is the guarantee, and the write has already happened ─────────
   * The repository persisted the record and bumped the revision before this runs, so by the time
   * `load()` re-reads, every other surface in the app is already keyed on the new revision. The
   * notification reconciliation then runs against the **committed** snapshot — it calls
   * `resolveCurrentLocation` itself, which reads the same storage — rather than against anything this
   * screen is holding in state.
   *
   * The reschedule's failure is reported separately and never reverts the save: Dubai's prayer times
   * are correct whether or not five alarms could be created, and undoing a correct calculation
   * because the notification platform refused would be the worse outcome.
   */
  const afterCommit = useCallback(
    async (savedLabel: string) => {
      await load();
      setPanel('none');
      await notifications.refreshSchedule();
      setNotice(`Saved. Prayer times are now calculated for ${savedLabel}.`);
      /*
        Back to Prayer times only once the whole mutation — write, revision, reconciliation — has
        resolved, so the screen the user lands on cannot be mid-update.
      */
      router.back();
    },
    [load, notifications, router],
  );

  return (
    <FaithScreen
      title="Prayer location"
      activeKey={faithNavKeys.worship}
      testID="faith-prayer-location"
    >
      <View style={{ rowGap: dp(moduleLayout.sectionGap) }}>
        {error === null ? null : (
          <ModuleStatusBanner tone="error" message={error} testID="faith-prayer-location-error" />
        )}
        {notice === null ? null : (
          <ModuleStatusBanner
            tone="success"
            message={notice}
            testID="faith-prayer-location-notice"
          />
        )}

        <CurrentLocationCard active={active} mode={mode} />

        <DeviceLocationSection
          mode={mode}
          activeLabel={active?.label ?? null}
          busy={busy}
          setBusy={setBusy}
          setError={setError}
          setNotice={setNotice}
          reload={load}
          notifications={notifications}
        />

        <FaithRowGroup title="Or choose a place yourself" testID="faith-prayer-location-modes">
          {[
            <FaithRow
              key="city"
              title="Choose a city"
              subtitle={
                mode === 'city'
                  ? 'Active — prayer times use the city you selected'
                  : 'Search a built-in list of cities. Works without a connection.'
              }
              icon="search"
              meta={mode === 'city' ? 'Active' : undefined}
              onPress={() => onChoose('city')}
              accessibilityLabel={`Choose a city. ${
                mode === 'city' ? 'Currently active.' : 'Opens an offline city search.'
              }`}
              testID="faith-prayer-location-mode-city"
            />,
            <FaithRow
              key="coordinates"
              title="Enter coordinates"
              subtitle={
                mode === 'coordinates'
                  ? 'Active — using coordinates you entered'
                  : 'For a place the city list does not include'
              }
              icon="note"
              meta={mode === 'coordinates' ? 'Active' : undefined}
              onPress={() => onChoose('coordinates')}
              accessibilityLabel={`Enter coordinates. ${
                mode === 'coordinates' ? 'Currently active.' : 'Opens the coordinate form.'
              }`}
              testID="faith-prayer-location-mode-coordinates"
            />,
          ]}
        </FaithRowGroup>

        {panel !== 'city' ? null : (
          <CitySearchPanel
            busy={busy}
            setBusy={setBusy}
            setError={setError}
            onSaved={afterCommit}
            onCancel={() => setPanel('none')}
          />
        )}

        {panel !== 'coordinates' ? null : (
          <CoordinatePanel
            busy={busy}
            setBusy={setBusy}
            setError={setError}
            onSaved={afterCommit}
            onCancel={() => setPanel('none')}
          />
        )}
      </View>
    </FaithScreen>
  );
}

/**
 * What is active right now, and where it came from.
 *
 * The GeoNames credit appears here and only in city mode, because that is the only mode whose data
 * is GeoNames' — crediting them beneath a device fix or a typed coordinate would attribute to them
 * something they did not supply, which is its own kind of false statement.
 */
function CurrentLocationCard({
  active,
  mode,
}: {
  readonly active: PrayerLocation | null;
  readonly mode: PrayerLocationMode | null;
}) {
  const { dp } = useModuleMetrics();
  return (
    <ModuleCard testID="faith-prayer-location-current">
      <View style={{ rowGap: dp(4) }}>
        <ModuleText token="cardHeading">Current location</ModuleText>
        <ModuleText token="cardTitle" testID="faith-prayer-location-current-label">
          {active?.label ?? 'No location set'}
        </ModuleText>
        <Detail label="Mode" value={MODE_LABEL[mode ?? 'unset']} testID="mode" />
        <Detail label="Timezone" value={active?.timeZone ?? '—'} testID="timezone" />
        <Detail
          label="Last updated"
          value={
            active === null || active.resolvedAt === null ? '—' : formatStamp(active.resolvedAt)
          }
          testID="updated"
        />
        <Detail
          label="Saved"
          value={active === null ? 'Nothing saved yet' : 'Saved on this device'}
          testID="saved"
        />
        {mode !== 'city' ? null : (
          <ModuleText token="caption" numberOfLines={4} testID="faith-prayer-location-attribution">
            {`${GEONAMES_ATTRIBUTION}. ${GEONAMES_USAGE_NOTE}`}
          </ModuleText>
        )}
      </View>
    </ModuleCard>
  );
}

/** How each mode is named on screen. `unset` is a key rather than a mode — nothing is stored yet. */
const MODE_LABEL: Readonly<Record<PrayerLocationMode | 'unset', string>> = {
  device: 'Device location',
  city: 'Selected city',
  coordinates: 'Coordinates',
  unset: 'Not set',
};

/**
 * The recommended option, and every way it can fail.
 *
 * ── Why the permission request lives behind this button ─────────────────────
 * NoorLife asks the OS for location only when somebody presses a control that says it will. This is
 * that control. Nothing on this screen prompts on mount, and `useLocationPermission` is the module's
 * only caller of `requestPermission` — see its own note.
 *
 * ── Why a refusal does not re-offer the same button ─────────────────────────
 * Android stops showing the system dialog after two refusals and iOS after one, so a "Try again" that
 * called `requestPermission` a third time would do nothing and look broken. Once the outcome is
 * `denied` or `services-disabled` the advice changes to naming the device settings, and the city and
 * coordinate options below remain fully available — which is the point: the app stays usable without
 * ever granting location.
 */
function DeviceLocationSection({
  mode,
  activeLabel,
  busy,
  setBusy,
  setError,
  setNotice,
  reload,
  notifications,
}: {
  readonly mode: PrayerLocationMode | null;
  readonly activeLabel: string | null;
  readonly busy: boolean;
  readonly setBusy: (value: boolean) => void;
  readonly setError: (value: string | null) => void;
  readonly setNotice: (value: string | null) => void;
  readonly reload: () => Promise<void>;
  readonly notifications: { readonly refreshSchedule: () => Promise<void> };
}) {
  const { dp } = useModuleMetrics();
  const { prayerTimes } = useFaithRepositories();
  const { outcome, requesting, request } = useLocationPermission();

  /**
   * Guards against a second press before the first has re-rendered the disabled button.
   *
   * `setBusy(true)` does not disable anything until React commits the next render, and two taps
   * inside that window both pass. A ref is checked and set synchronously, so the second tap returns
   * before it can start a second permission prompt and a second native fix. The disabled state below
   * is what a user sees; this is what makes it true.
   */
  const inFlight = useRef(false);

  /**
   * Permission first, then the fix, then the write — and nothing is written until all three succeed.
   *
   * The repository enforces that order; this only has to report it. Every failure path below leaves
   * the saved location untouched and says which one is still active by name.
   */
  const onUseDevice = useCallback(async () => {
    if (inFlight.current) {
      return;
    }
    inFlight.current = true;
    setNotice(null);
    setBusy(true);
    /*
      ── Every failure below says the same second sentence ────────────────────
      Nothing is written unless a real fix was obtained, so a refusal, a disabled service and a cold
      GPS all leave the saved location exactly as it was. Saying only what went wrong would leave the
      user unsure what their prayer times are now calculated from — which is the question they
      actually have — so each message names the location that is still in force.
    */
    /*
      ── The no-location case is a different sentence, not a softer one ───────
      "Your previous location remains active" is false on a fresh install, and it is the exact class
      of statement this module exists to avoid: plausible, reassuring, and describing something that
      does not exist. With nothing saved there is nothing to retain, and the honest thing is to point
      at the two options that are still available.
    */
    const kept =
      activeLabel === null
        ? 'You can choose a city or enter coordinates below instead.'
        : `Your saved location, ${activeLabel}, remains active.`;
    try {
      /*
        Asked before the fix is attempted, so a user who has never been prompted sees the OS dialog
        rather than an unexplained "could not get a position". A refusal falls through to the same
        message path — `switchToDeviceLocation` will decline for the same reason and write nothing.
      */
      const permission = await request();
      if (permission !== 'granted') {
        setError(
          `${
            permissionAdvice(permission) ??
            'NoorLife could not get permission to use this device’s location.'
          } ${kept}`,
        );
        return;
      }

      const result = await prayerTimes.switchToDeviceLocation();

      /*
        ── Supersession is not a failure, and must not look like one ──────────
        `unsupported` here means a newer choice claimed authority while this fix was being acquired —
        the user saved a city, or pressed the button again. They got exactly what they asked for, and
        an error banner would be alarming them about the app working correctly. Nothing was written by
        this attempt, so nothing needs saying; the card already shows the location that won.
      */
      if (result.kind === 'error' && result.code === 'unsupported') {
        setError(null);
        await reload();
        return;
      }

      if (!hasData(result)) {
        setError(
          `${
            result.kind === 'error' && result.code === 'timeout'
              ? 'Could not get a position in time — this can happen indoors or with a cold GPS.'
              : 'Could not get a position from this device.'
          } ${kept}`,
        );
        return;
      }

      setError(null);
      await reload();
      await notifications.refreshSchedule();
      setNotice(`Now using your device location: ${result.data.label}.`);
    } finally {
      setBusy(false);
      // Released only here, so a deliberate retry after the attempt finishes starts a new operation.
      inFlight.current = false;
    }
  }, [activeLabel, notifications, prayerTimes, reload, request, setBusy, setError, setNotice]);

  const advice = permissionAdvice(outcome);

  return (
    <ModuleCard testID="faith-prayer-location-device">
      <View style={{ rowGap: dp(8) }}>
        <View style={{ flexDirection: 'row', columnGap: dp(8), alignItems: 'center' }}>
          <ModuleText token="cardHeading" style={{ flex: 1 }}>
            Use device location
          </ModuleText>
          <ModuleText token="rowMeta" testID="faith-prayer-location-device-recommended">
            {mode === 'device' ? 'Active' : 'Recommended'}
          </ModuleText>
        </View>
        <ModuleText token="body" numberOfLines={4} testID="faith-prayer-location-device-rationale">
          NoorLife uses this device’s position to calculate your prayer times and the direction of
          the Qibla. Your location stays on this device.
        </ModuleText>

        {advice === null ? null : (
          <ModuleText
            token="caption"
            numberOfLines={4}
            testID="faith-prayer-location-device-advice"
          >
            {advice}
          </ModuleText>
        )}

        <ModuleButton
          label={mode === 'device' ? 'Refresh device location' : 'Use device location'}
          variant="primary"
          onPress={() => void onUseDevice()}
          disabled={busy || requesting}
          loading={busy || requesting}
          accessibilityHint="Asks this device for your position and calculates prayer times from it."
          testID="faith-prayer-location-use-device"
        />

        {/*
          ── Offered only once the OS will no longer show its own dialog ──────
          Android stops presenting the system prompt after two refusals and iOS after one, so past
          that point the button above is a control that cannot do anything and the only route is the
          app's settings page. Rendering this unconditionally would send a first-time user out of the
          app to grant something the prompt was about to ask for.
        */}
        {outcome !== 'denied' && outcome !== 'services-disabled' ? null : (
          <ModuleButton
            label="Open device settings"
            variant="secondary"
            onPress={() => void Linking.openSettings()}
            disabled={busy}
            accessibilityHint="Opens this device’s settings, where location access can be turned on."
            testID="faith-prayer-location-open-settings"
          />
        )}
      </View>
    </ModuleCard>
  );
}

/**
 * Offline city search, preview and save.
 *
 * ── Stale-result protection, and why a counter rather than a debounce ───────
 * Every search is stamped with a monotonically increasing token, and a result is applied only if its
 * token is still the newest. Searches are asynchronous — the catalogue's first load parses 2.19 MB —
 * so "dub" can resolve *after* "dubai" and repaint the list with results for a query the user has
 * already finished typing. A debounce reduces how often that happens and cannot prevent it; the token
 * makes applying a stale result unrepresentable.
 *
 * The same token is what cancels: clearing the field or closing the panel bumps it, so anything still
 * in flight lands on a token that is no longer current and is discarded.
 */
function CitySearchPanel({
  busy,
  setBusy,
  setError,
  onSaved,
  onCancel,
}: {
  readonly busy: boolean;
  readonly setBusy: (value: boolean) => void;
  readonly setError: (value: string | null) => void;
  readonly onSaved: (label: string) => Promise<void>;
  readonly onCancel: () => void;
}) {
  const { dp } = useModuleMetrics();
  const { prayerTimes } = useFaithRepositories();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<readonly CityChoice[]>([]);
  const [searching, setSearching] = useState(false);
  /** True once a search has run for the current query, so "no matches" is only shown after one has. */
  const [searched, setSearched] = useState(false);
  const [preview, setPreview] = useState<CityPreview | null>(null);

  const token = useRef(0);
  /**
   * False once this panel has gone away.
   *
   * ── Why a token alone is not enough ─────────────────────────────────────
   * The token discards a *stale* result while the panel is still on screen. It cannot discard one
   * that arrives after the panel has been unmounted — closing the panel or leaving the screen mid-
   * search leaves a promise holding setters for a component React has already dropped. Applying
   * those is a no-op React warns about, and it makes the search's completion observable in a tree
   * that no longer exists.
   */
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      // Anything still in flight lands on a token that is no longer current, and is dropped.
      token.current += 1;
    };
  }, []);

  const onQueryChanged = useCallback(
    (value: string) => {
      setQuery(value);
      /*
        A new keystroke invalidates the preview as well as the results. Leaving a preview on screen
        while the list beneath it changes would let somebody confirm Dubai, keep typing, and save a
        city they are no longer looking at — and Save is gated on the preview, so clearing it also
        disables Save until they pick again.
      */
      setPreview(null);
      setError(null);

      const mine = (token.current += 1);
      if (normalizedLength(value) < MIN_QUERY) {
        setResults([]);
        setSearched(false);
        setSearching(false);
        return;
      }

      setSearching(true);
      void (async () => {
        const outcome = await prayerTimes.searchCities(value);
        // Stale, or the panel is gone. Either way this result has nowhere to land.
        if (mine !== token.current || !alive.current) {
          return;
        }
        setResults(hasData(outcome) ? outcome.data : []);
        setSearched(true);
        setSearching(false);
      })();
    },
    [prayerTimes, setError],
  );

  const onSelect = useCallback(
    async (city: CityChoice) => {
      const resolved = await prayerTimes.previewCity(city);
      if (!hasData(resolved)) {
        setError('That city’s timezone could not be resolved. Try another, or enter coordinates.');
        return;
      }
      setError(null);
      setPreview(resolved.data);
    },
    [prayerTimes, setError],
  );

  const onSave = useCallback(async () => {
    if (preview === null) {
      return;
    }
    setBusy(true);
    try {
      const saved = await prayerTimes.saveCityLocation(preview.city);
      if (!hasData(saved)) {
        /*
          The panel keeps its query, its results and its preview, so the user can pick again rather
          than start over — and nothing was written, so whatever was active still is.
        */
        setError('That city could not be saved. Your previous location is still active.');
        return;
      }
      await onSaved(saved.data.label);
    } finally {
      setBusy(false);
    }
  }, [onSaved, prayerTimes, preview, setBusy, setError]);

  return (
    <ModuleCard testID="faith-prayer-location-city-panel">
      <View style={{ rowGap: dp(8) }}>
        <ModuleText token="cardHeading">Choose a city</ModuleText>
        <ModuleText token="body" numberOfLines={3}>
          Cities are bundled with the app. Nothing you type here is sent anywhere.
        </ModuleText>

        <Field
          label="City"
          value={query}
          onChangeText={onQueryChanged}
          placeholder="Start typing a city name"
          accessibilityLabel="City search. Type at least two letters to see matching cities."
          testID="faith-prayer-location-city-input"
        />

        {searching ? (
          <View
            style={{ flexDirection: 'row', columnGap: dp(8), alignItems: 'center' }}
            accessible
            accessibilityLabel="Searching cities"
            testID="faith-prayer-location-city-searching"
          >
            <ActivityIndicator size="small" color={moduleNeutrals.textTertiary} />
            <ModuleText token="rowMeta">Searching…</ModuleText>
          </View>
        ) : normalizedLength(query) < MIN_QUERY ? (
          <ModuleText token="rowMeta" testID="faith-prayer-location-city-prompt">
            Type at least two letters.
          </ModuleText>
        ) : searched && results.length === 0 ? (
          <ModuleText token="rowMeta" numberOfLines={3} testID="faith-prayer-location-city-empty">
            No cities match “{query.trim()}”. Check the spelling, or enter coordinates instead.
          </ModuleText>
        ) : null}

        {results.length === 0 ? null : (
          <View style={{ rowGap: dp(2) }} testID="faith-prayer-location-city-results">
            {results.map((city) => (
              <CityResultRow
                key={city.geonamesId}
                city={city}
                selected={preview?.city.geonamesId === city.geonamesId}
                onPress={() => void onSelect(city)}
              />
            ))}
          </View>
        )}

        {preview === null ? null : <CityPreviewBox preview={preview} />}

        <View style={{ rowGap: dp(BUTTON_GAP_DP) }}>
          <ModuleButton
            label="Save city"
            variant="primary"
            onPress={() => void onSave()}
            /*
              Gated on a *current* preview rather than on a selection. The preview is where the
              coordinate and the resolved timezone are shown, so requiring it means nobody can commit
              every prayer time in the app to a city whose zone they never saw.
            */
            disabled={preview === null || busy}
            loading={busy}
            accessibilityHint={
              preview === null
                ? 'Select a city from the results to see its timezone first.'
                : 'Saves this city and recalculates today’s prayer times.'
            }
            testID="faith-prayer-location-city-save"
          />
          <ModuleButton
            label="Cancel"
            variant="tertiary"
            onPress={onCancel}
            disabled={busy}
            accessibilityHint="Returns without changing your saved location."
            testID="faith-prayer-location-city-cancel"
          />
        </View>
      </View>
    </ModuleCard>
  );
}

/**
 * One search result.
 *
 * ── Why the accessibility label restates what the row shows ────────────────
 * The visible row splits the place across two lines with a bullet separator, which a screen reader
 * announces as fragments. Naming the city, its region and its country in one sentence — and saying
 * what selecting it does — is what makes the list usable without sight, and this is a list where
 * picking the wrong row silently changes every prayer time in the app.
 */
function CityResultRow({
  city,
  selected,
  onPress,
}: {
  readonly city: CityChoice;
  readonly selected: boolean;
  readonly onPress: () => void;
}) {
  const { dp } = useModuleMetrics();
  const theme = useModuleTheme();
  const where =
    city.region === null || city.region === city.name
      ? city.countryName
      : `${city.region} • ${city.countryName}`;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${cityLabel(city)}. Select to preview its timezone before saving.`}
      style={({ pressed }) => ({
        minHeight: minimumTouchTargetSize(),
        justifyContent: 'center',
        paddingHorizontal: dp(8),
        paddingVertical: dp(6),
        borderRadius: dp(moduleLayout.radiusSmall),
        backgroundColor: selected || pressed ? theme.lightSurface : 'transparent',
      })}
      testID={`faith-prayer-location-city-result-${city.geonamesId}`}
    >
      <ModuleText token="rowLabel" numberOfLines={1}>
        {city.name}
      </ModuleText>
      <ModuleText token="rowMeta" numberOfLines={1}>
        {where}
      </ModuleText>
    </Pressable>
  );
}

/**
 * The selected city, with everything needed to confirm it is the right one.
 *
 * The coordinate and the zone are the two facts that distinguish one Dubai from another, and the
 * GeoNames credit sits with them because this is the moment the data is actually being used.
 */
function CityPreviewBox({ preview }: { readonly preview: CityPreview }) {
  const { dp } = useModuleMetrics();
  const theme = useModuleTheme();
  const { city } = preview;
  return (
    <View
      style={{
        backgroundColor: theme.lightSurface,
        borderRadius: dp(moduleLayout.radiusSmall),
        padding: dp(10),
        rowGap: dp(3),
      }}
      accessible
      accessibilityLabel={`Preview. ${cityLabel(city)}. Coordinates ${formatCoordinate(city.coordinate.latitude)}, ${formatCoordinate(city.coordinate.longitude)}. Timezone ${preview.timeZone}. Save to calculate prayer times for this city.`}
      testID="faith-prayer-location-city-preview"
    >
      <ModuleText token="rowMeta">Selected city</ModuleText>
      <ModuleText token="cardTitle" numberOfLines={2} testID="faith-prayer-location-preview-city">
        {cityLabel(city)}
      </ModuleText>
      <Detail
        label="Coordinates"
        value={`${formatCoordinate(city.coordinate.latitude)}, ${formatCoordinate(city.coordinate.longitude)}`}
        testID="preview-coordinates"
      />
      <Detail label="Timezone" value={preview.timeZone} testID="preview-timezone" />
      <ModuleText token="caption" numberOfLines={3} testID="faith-prayer-location-preview-credit">
        {preview.attribution}
      </ModuleText>
    </View>
  );
}

/**
 * The typed-coordinate form.
 *
 * Unchanged in substance from the version this screen shipped with: strict parsing, a preview that is
 * invalidated by any edit, Save gated on a current preview, and the disclosure that a label the user
 * typed is their own reference and is not verified by anything.
 */
function CoordinatePanel({
  busy,
  setBusy,
  setError,
  onSaved,
  onCancel,
}: {
  readonly busy: boolean;
  readonly setBusy: (value: boolean) => void;
  readonly setError: (value: string | null) => void;
  readonly onSaved: (label: string) => Promise<void>;
  readonly onCancel: () => void;
}) {
  const { dp } = useModuleMetrics();
  const { prayerTimes } = useFaithRepositories();

  const [label, setLabel] = useState('');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [preview, setPreview] = useState<PrayerLocation | null>(null);

  /**
   * Editing a coordinate invalidates the preview.
   *
   * The resolved timezone is only meaningful for the numbers it was resolved from. Leaving it on
   * screen after an edit would let somebody confirm `Asia/Dubai`, change a digit, and save a
   * coordinate whose zone they never saw — and Save is gated on the preview existing, so clearing it
   * also disables Save until they look again.
   */
  const onCoordinateEdited = useCallback(
    (setter: (value: string) => void) => (value: string) => {
      setter(value);
      setPreview(null);
    },
    [],
  );

  const onPreview = useCallback(() => {
    const lat = parseCoordinateInput(latitude, 'latitude');
    if (lat.kind === 'invalid') {
      setPreview(null);
      setError(coordinateErrorMessage(lat.reason, 'latitude'));
      return null;
    }
    const lon = parseCoordinateInput(longitude, 'longitude');
    if (lon.kind === 'invalid') {
      setPreview(null);
      setError(coordinateErrorMessage(lon.reason, 'longitude'));
      return null;
    }

    const resolved = prayerTimes.previewLocation({ latitude: lat.value, longitude: lon.value });
    if (resolved === null) {
      setPreview(null);
      setError('No timezone could be resolved for those coordinates. Check them and try again.');
      return null;
    }
    setError(null);
    setPreview(resolved);
    return { latitude: lat.value, longitude: lon.value };
  }, [latitude, longitude, prayerTimes, setError]);

  const onSave = useCallback(async () => {
    const coordinate = onPreview();
    if (coordinate === null) {
      return;
    }

    setBusy(true);
    try {
      const saved = await prayerTimes.saveCoordinateLocation({ label, coordinate });
      if (!hasData(saved)) {
        // The form keeps its values, so the user can correct rather than retype.
        setError('That location could not be saved. Check the coordinates and try again.');
        return;
      }
      await onSaved(saved.data.label);
    } finally {
      setBusy(false);
    }
  }, [label, onPreview, onSaved, prayerTimes, setBusy, setError]);

  return (
    <ModuleCard testID="faith-prayer-location-form">
      <View style={{ rowGap: dp(8) }}>
        <ModuleText token="cardHeading">Custom coordinates</ModuleText>
        {/* Required copy. Verbatim — it is the whole disclosure about what a label is worth. */}
        <ModuleText token="body" testID="faith-prayer-location-disclosure">
          Prayer times are calculated from these coordinates. The location label is for your
          reference and is not verified.
        </ModuleText>

        <Field
          label="Location label"
          value={label}
          onChangeText={setLabel}
          placeholder="e.g. Dubai, UAE"
          accessibilityLabel="Location label. For your reference only; it is not verified."
          testID="faith-prayer-location-label-input"
        />
        <Field
          label="Latitude"
          value={latitude}
          onChangeText={onCoordinateEdited(setLatitude)}
          placeholder="Between −90 and 90"
          keyboardType="numbers-and-punctuation"
          accessibilityLabel="Latitude. A number between minus 90 and 90."
          testID="faith-prayer-location-latitude-input"
        />
        <Field
          label="Longitude"
          value={longitude}
          onChangeText={onCoordinateEdited(setLongitude)}
          placeholder="Between −180 and 180"
          keyboardType="numbers-and-punctuation"
          accessibilityLabel="Longitude. A number between minus 180 and 180."
          testID="faith-prayer-location-longitude-input"
        />

        {preview === null ? null : <TimeZonePreviewBox timeZone={preview.timeZone} />}

        {/*
          ── One full-width stack, in commitment order ────────────────────────
          Preview, then Save, then Cancel — the order a user moves through them. All three are full
          width and aligned to the form above, so Save's dominance comes from being the only filled
          control rather than from being wider or first.
        */}
        <View style={{ rowGap: dp(BUTTON_GAP_DP) }}>
          <ModuleButton
            label="Preview location"
            variant="secondary"
            onPress={() => void onPreview()}
            disabled={busy}
            accessibilityHint="Resolves the timezone for these coordinates without saving them."
            testID="faith-prayer-location-preview-action"
          />
          <ModuleButton
            label="Save location"
            variant="primary"
            onPress={() => void onSave()}
            disabled={preview === null || busy}
            loading={busy}
            accessibilityHint={
              preview === null
                ? 'Preview the location first to confirm its timezone.'
                : 'Saves these coordinates and recalculates today’s prayer times.'
            }
            testID="faith-prayer-location-save"
          />
          <ModuleButton
            label="Cancel"
            variant="tertiary"
            onPress={onCancel}
            disabled={busy}
            accessibilityHint="Returns without changing your saved location."
            testID="faith-prayer-location-cancel"
          />
        </View>
      </View>
    </ModuleCard>
  );
}

/** The resolved timezone for a typed coordinate, on the module's own pale surface. */
function TimeZonePreviewBox({ timeZone }: { readonly timeZone: string }) {
  const { dp } = useModuleMetrics();
  const theme = useModuleTheme();
  return (
    <View
      style={{
        backgroundColor: theme.lightSurface,
        borderRadius: dp(moduleLayout.radiusSmall),
        padding: dp(10),
        rowGap: dp(2),
      }}
      accessible
      accessibilityLabel={`Preview. Timezone ${timeZone}. Prayer times will be calculated for this coordinate.`}
      testID="faith-prayer-location-preview"
    >
      <ModuleText token="rowMeta">Resolved timezone</ModuleText>
      <ModuleText token="cardTitle" testID="faith-prayer-location-preview-timezone">
        {timeZone}
      </ModuleText>
    </View>
  );
}

function Detail({
  label,
  value,
  testID,
}: {
  readonly label: string;
  readonly value: string;
  readonly testID: string;
}) {
  const { dp } = useModuleMetrics();
  return (
    <View
      style={{ flexDirection: 'row', columnGap: dp(8) }}
      accessible
      accessibilityLabel={`${label}: ${value}`}
      testID={`faith-prayer-location-${testID}`}
    >
      <ModuleText token="rowMeta" style={{ flex: 1 }}>
        {label}
      </ModuleText>
      <ModuleText token="rowLabel" style={{ flex: 1 }} align="right">
        {value}
      </ModuleText>
    </View>
  );
}

function Field({
  label,
  accessibilityLabel,
  testID,
  ...input
}: {
  readonly label: string;
  readonly value: string;
  readonly onChangeText: (value: string) => void;
  readonly placeholder: string;
  readonly keyboardType?: 'numbers-and-punctuation';
  readonly accessibilityLabel: string;
  readonly testID: string;
}) {
  const { dp, type } = useModuleMetrics();
  return (
    <View style={{ rowGap: dp(3) }}>
      <ModuleText token="rowMeta">{label}</ModuleText>
      <TextInput
        {...input}
        accessibilityLabel={accessibilityLabel}
        placeholderTextColor={moduleNeutrals.textTertiary}
        autoCapitalize="none"
        autoCorrect={false}
        style={{
          borderWidth: 1,
          borderColor: moduleNeutrals.border,
          borderRadius: dp(moduleLayout.radiusSmall),
          paddingHorizontal: dp(10),
          paddingVertical: dp(9),
          color: moduleNeutrals.textPrimary,
          fontSize: type('body').fontSize,
        }}
        testID={testID}
      />
    </View>
  );
}

/** The gap between the stacked action controls, within the reference's 10–12 dp. */
const BUTTON_GAP_DP = 11;

/**
 * The shortest query that is searched.
 *
 * Mirrors `MIN_QUERY_LENGTH` in `city-search.ts`, and is measured the same way — after normalisation,
 * so `"a-"` is one meaningful character and is not searched. The screen needs its own copy because it
 * decides which *prompt* to render before any search has run, and importing the search module here
 * would pull the catalogue reader into this screen's import graph for a constant.
 */
const MIN_QUERY = 2;

/** How many meaningful characters a query has, ignoring punctuation and spacing. */
function normalizedLength(value: string): number {
  return value.replace(/[^\p{Letter}\p{Number}]+/gu, '').length;
}

/**
 * A coordinate as it is displayed.
 *
 * Four decimals — about eleven metres, which is finer than any prayer-time calculation can perceive
 * and coarse enough to stay on one line at a 1.5 font scale.
 */
function formatCoordinate(value: number): string {
  return value.toFixed(4);
}

/** A stored timestamp as a short local string, or an em dash when there is none. */
function formatStamp(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return '—';
  }
  /*
    The *device's* clock is the right frame here, and it is the only place in this module where that
    is true: "last updated" is a fact about when the phone did something, not about the prayer
    location's day. Every prayer time remains stamped in the location's own zone.
  */
  return parsed.toLocaleString();
}
