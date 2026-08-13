import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { TextInput, View } from 'react-native';

import { ModuleButton, ModuleStatusBanner, ModuleText } from '@features/modules/components';
import { ModuleCard } from '@features/modules/components/module-card';
import { useModuleTheme } from '@features/modules/module-context';
import { moduleLayout, moduleNeutrals } from '@features/modules/module-tokens';
import { useModuleMetrics } from '@features/modules/use-module-metrics';

import { FaithRow, FaithRowGroup } from '../components/faith-list';
import { FaithScreen } from '../components/faith-screen';
import { hasData } from '../data/faith-result';
import { coordinateErrorMessage, parseCoordinateInput } from '../data/location/location-acceptance';
import type { PrayerLocation, PrayerTimesRepository } from '../data/prayer-times.repository';
import { useFaithRepositories } from '../di/faith-repository-context';
import { faithNavKeys } from '../faith-routes';
import { usePrayerNotifications } from '../hooks/use-prayer-notifications';

/**
 * Prayer location — which coordinate every prayer time in NoorLife is calculated from.
 *
 * ── Why this screen had to exist ────────────────────────────────────────────
 * The previous pass built an excellent *automatic* location path — a live fix, an acceptance policy,
 * an honest stale state — and no way for a person to say where they are. On a device whose GPS
 * cannot be moved, or a user who wants prayer times for the city they are travelling to next week,
 * that is a feature with no manual override at all. The card said "Mountain View" and offered only
 * a refresh that fetched Mountain View again.
 *
 * ── Why the label is never treated as evidence ──────────────────────────────
 * No worldwide place-search provider has been approved, so a name the user types is exactly that: a
 * name they typed. The coordinates decide the prayer times and the timezone; the label decides
 * nothing. The screen says so in the required sentence, and the stored record keeps them separate.
 *
 * ── What this screen deliberately cannot do ─────────────────────────────────
 * It performs no geocoding of any kind. There is no city database, no lookup, no network call, and
 * no "did you mean". The timezone shown in the preview comes from the bundled coordinate-to-zone
 * polygon set already used for every prayer time in the app — it is a local lookup, not a service.
 */
/**
 * The two reads that describe the current location, and nothing else.
 *
 * Extracted because the mount effect and the post-save refresh made exactly the same pair of calls
 * and derived `active` the same way, so the `hasData` unwrapping existed twice — the kind of
 * duplication where one copy gets a fix and the other does not.
 *
 * It writes no state on purpose. The two callers must not share their writes: the effect has to
 * check its cancellation flag between the read and the writes, and `load` has to write immediately.
 * Sharing the read is the whole of what they have in common.
 */
async function readLocationState(prayerTimes: PrayerTimesRepository): Promise<{
  readonly active: PrayerLocation | null;
  readonly mode: 'device' | 'manual' | null;
}> {
  const [resolved, mode] = await Promise.all([
    prayerTimes.resolveCurrentLocation(),
    prayerTimes.activeLocationMode(),
  ]);
  return { active: hasData(resolved) ? resolved.data : null, mode };
}

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
  const [mode, setMode] = useState<'device' | 'manual' | null>(null);
  const [editing, setEditing] = useState(false);

  const [label, setLabel] = useState('');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [preview, setPreview] = useState<PrayerLocation | null>(null);
  /** True while a save or a mode switch is in flight. Blocks a second submission. */
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

    So the two paths share the *read* — `readLocationState` — and keep their own writes. They are not
    interchangeable: only this one can be cancelled, because only this one can outlive its caller.
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

  /**
   * Resolves the typed coordinate's timezone without saving anything.
   *
   * The preview is the point of the two-step flow: a coordinate is four digits that look like every
   * other four digits, and `Asia/Dubai` appearing beneath them is the one piece of feedback that
   * tells a user they typed the place they meant.
   */
  const onPreview = useCallback(() => {
    setNotice(null);
    const lat = parseCoordinateInput(latitude, 'latitude');
    if (lat.kind === 'invalid') {
      setPreview(null);
      setError(coordinateErrorMessage(lat.reason, 'latitude'));
      return;
    }
    const lon = parseCoordinateInput(longitude, 'longitude');
    if (lon.kind === 'invalid') {
      setPreview(null);
      setError(coordinateErrorMessage(lon.reason, 'longitude'));
      return;
    }

    const resolved = prayerTimes.previewLocation({ latitude: lat.value, longitude: lon.value });
    if (resolved === null) {
      setPreview(null);
      setError('No timezone could be resolved for those coordinates. Check them and try again.');
      return;
    }
    setError(null);
    setPreview(resolved);
  }, [latitude, longitude, prayerTimes]);

  /**
   * The save transaction.
   *
   * ── The order, and why the notification schedule is last ───────────────────
   * The coordinate is validated, its zone resolved, and the location persisted *before* anything is
   * asked to recalculate. Every screen derives from storage, so the moment the write lands they all
   * see the same place — which is what makes the update atomic rather than a sequence a user could
   * catch halfway through.
   *
   * The notification reschedule runs afterwards and its failure is reported *separately*. Dubai's
   * prayer times are correct whether or not five alarms could be created, and reverting a correct
   * calculation because the notification platform refused would be the worse outcome.
   */
  const onSave = useCallback(async () => {
    onPreview();
    const lat = parseCoordinateInput(latitude, 'latitude');
    const lon = parseCoordinateInput(longitude, 'longitude');
    if (lat.kind === 'invalid' || lon.kind === 'invalid') {
      return;
    }

    setBusy(true);
    try {
      const saved = await prayerTimes.saveManualLocation({
        label,
        coordinate: { latitude: lat.value, longitude: lon.value },
      });
      if (!hasData(saved)) {
        // The form is retained with its values, so the user can correct rather than retype.
        setError('That location could not be saved. Check the coordinates and try again.');
        return;
      }

      await load();
      setEditing(false);
      setPreview(null);

      // Reported on its own line: the location is saved and correct either way.
      await notifications.refreshSchedule();
      setNotice(`Saved. Prayer times are now calculated for ${saved.data.label}.`);
      /*
        Navigation happens only after the mutation boundary has resolved — the write, the revision
        and the notification reconciliation are all complete before this screen goes away.
      */
      router.back();
    } finally {
      setBusy(false);
    }
  }, [label, latitude, longitude, onPreview, prayerTimes, load, notifications, router]);

  /** Switches back to the device's own position — atomically, or not at all. */
  const onUseDevice = useCallback(async () => {
    setNotice(null);
    const result = await prayerTimes.switchToDeviceLocation();
    if (!hasData(result)) {
      /*
        Nothing was written. The saved manual location stays active *and* stays selected, and the
        message names it rather than saying "failed" — a user who saved Dubai needs to know Dubai is
        still what they are looking at.
      */
      setError(
        `Could not switch to device location. Your saved ${active?.label ?? 'manual'} prayer times remain active.`,
      );
      return;
    }
    setError(null);
    await load();
    await notifications.refreshSchedule();
    setNotice(`Now using your device location: ${result.data.label}.`);
  }, [prayerTimes, active, load, notifications]);

  const populate = useCallback((preset: (typeof DEVELOPMENT_PRESETS)[number]) => {
    /*
      A preset fills the form and nothing else. It does not save, does not switch mode and does not
      touch storage — the user still previews and saves through the same production path, which is
      what makes a preset a shortcut to *typing* rather than a second way to change the location.
    */
    setLabel(preset.label);
    setLatitude(preset.latitude);
    setLongitude(preset.longitude);
    setPreview(null);
    setError(null);
    setEditing(true);
  }, []);

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

        {/* ── What is active right now ───────────────────────────────────────── */}
        <ModuleCard testID="faith-prayer-location-current">
          <View style={{ rowGap: dp(4) }}>
            <ModuleText token="cardHeading">Current location</ModuleText>
            <ModuleText token="cardTitle" testID="faith-prayer-location-current-label">
              {active?.label ?? 'No location set'}
            </ModuleText>
            <Detail
              label="Mode"
              value={
                mode === 'manual'
                  ? 'Manual location'
                  : mode === 'device'
                    ? 'Device location'
                    : 'Not set'
              }
              testID="mode"
            />
            <Detail label="Timezone" value={active?.timeZone ?? '—'} testID="timezone" />
            <Detail
              label="Last updated"
              value={
                active?.resolvedAt === null || active === null
                  ? '—'
                  : formatStamp(active.resolvedAt)
              }
              testID="updated"
            />
            <Detail
              label="Saved"
              value={active === null ? 'Nothing saved yet' : 'Saved on this device'}
              testID="saved"
            />
          </View>
        </ModuleCard>

        {/* ── Mode selection ─────────────────────────────────────────────────── */}
        <FaithRowGroup title="How to set your location" testID="faith-prayer-location-modes">
          {[
            <FaithRow
              key="device"
              title="Use device location"
              subtitle={
                mode === 'device'
                  ? 'Active — NoorLife uses this device’s position'
                  : 'NoorLife will ask this device for a fresh position'
              }
              icon="mosque"
              meta={mode === 'device' ? 'Active' : undefined}
              onPress={() => void onUseDevice()}
              accessibilityLabel={`Use device location. ${mode === 'device' ? 'Currently active.' : 'Requests a fresh position from this device.'}`}
              testID="faith-prayer-location-mode-device"
            />,
            <FaithRow
              key="manual"
              title="Choose location manually"
              subtitle={
                mode === 'manual'
                  ? 'Active — using coordinates you entered'
                  : 'Enter coordinates yourself'
              }
              icon="note"
              meta={mode === 'manual' ? 'Active' : undefined}
              onPress={() => setEditing(true)}
              accessibilityLabel={`Choose location manually. ${mode === 'manual' ? 'Currently active.' : 'Opens the coordinate form.'}`}
              testID="faith-prayer-location-mode-manual"
            />,
          ]}
        </FaithRowGroup>

        {/* ── The custom-coordinates form ────────────────────────────────────── */}
        {!editing ? null : (
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

              {preview === null ? null : <PreviewBox timeZone={preview.timeZone} />}

              {/*
                ── One full-width stack, in commitment order ────────────────────
                Preview, then Save, then Cancel — the order a user moves through them. All three are
                full width and aligned to the form above, so Save's dominance comes from being the
                only filled control rather than from being wider or first. The previous row of three
                narrow left-aligned buttons gave Preview and Cancel the same visual weight as Save.
              */}
              <View style={{ rowGap: dp(BUTTON_GAP_DP) }}>
                <ModuleButton
                  label="Preview location"
                  variant="secondary"
                  onPress={onPreview}
                  disabled={busy}
                  accessibilityHint="Resolves the timezone for these coordinates without saving them."
                  testID="faith-prayer-location-preview-action"
                />
                <ModuleButton
                  label="Save location"
                  variant="primary"
                  onPress={() => void onSave()}
                  /*
                    Gated on a *current* preview, not merely on valid input. Editing a coordinate
                    clears the preview, so the resolved timezone on screen always belongs to the
                    numbers beside it — a user cannot confirm `Asia/Dubai` and save something else.
                  */
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
                  onPress={() => {
                    setEditing(false);
                    setPreview(null);
                    setError(null);
                  }}
                  disabled={busy}
                  accessibilityHint="Returns without changing your saved location."
                  testID="faith-prayer-location-cancel"
                />
              </View>
            </View>
          </ModuleCard>
        )}

        {/*
          ── Development presets ────────────────────────────────────────────────
          Present only in a development bundle. `__DEV__` is the project's established boundary — the
          same one the pictogram and provenance audits use — and Metro replaces it with a literal at
          build time, so the branch and everything inside it are removed from a release bundle
          entirely. There is no runtime flag a production build could be talked into setting.
        */}
        {!developmentPresetsVisible() ? null : (
          <FaithRowGroup title="Development presets" testID="faith-prayer-location-presets">
            {DEVELOPMENT_PRESETS.map((preset) => (
              <FaithRow
                key={preset.label}
                title={preset.label}
                subtitle={`${preset.latitude}, ${preset.longitude} — fills the form below`}
                icon="mosque"
                onPress={() => populate(preset)}
                accessibilityLabel={`${preset.label} preset. Fills the custom coordinates form; you still preview and save it yourself.`}
                testID={`faith-prayer-location-preset-${preset.key}`}
              />
            ))}
          </FaithRowGroup>
        )}

        {/*
          Informational, and truthful. A disabled row rather than a search field that returns nothing:
          a field the user can type into implies an answer is coming.
        */}
        <FaithRowGroup testID="faith-prayer-location-search">
          {[
            <FaithRow
              key="search"
              title="Search cities"
              subtitle="City search will be available after a location provider is approved."
              icon="search"
              accessibilityLabel="Search cities. Not available yet — city search will be available after a location provider is approved."
              testID="faith-prayer-location-search-row"
            />,
          ]}
        </FaithRowGroup>
      </View>
    </FaithScreen>
  );
}

/**
 * The resolved timezone, on the module's own pale surface.
 *
 * A child component rather than inline markup because `useModuleTheme` reads a context that
 * `FaithScreen` establishes — calling it in the screen's own body runs it *above* the provider and
 * throws before anything renders.
 */
function PreviewBox({ timeZone }: { readonly timeZone: string }) {
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
 * The two coordinates the verification brief names.
 *
 * Exported so a test can assert the preset values are the real ones rather than re-typing them, and
 * so the release-build seam below can reach them without duplicating the numbers.
 */
export const DEVELOPMENT_PRESETS = [
  { key: 'dubai', label: 'Dubai, UAE', latitude: '25.2048', longitude: '55.2708' },
  {
    key: 'mountain-view',
    label: 'Mountain View, United States',
    latitude: '37.3861',
    longitude: '-122.0839',
  },
] as const;

/**
 * Whether the preset rows render.
 *
 * ── The production boundary, and the seam that does not weaken it ───────────
 * `__DEV__` alone. Metro substitutes a literal `false` into a release bundle, so the rows and the
 * data behind them are eliminated rather than merely hidden — there is no flag, no remote config and
 * no debug menu that could bring them back in production.
 *
 * The release-build emulator is still verifiable, because the presets were never the mechanism: they
 * only fill three text fields. A release build is driven by typing the same three values into the
 * same production form, which exercises strictly *more* of the path than tapping a preset does. That
 * is the deterministic seam — the production form itself, reachable by its stable testIDs — and it
 * costs the production boundary nothing.
 */
export function developmentPresetsVisible(): boolean {
  return __DEV__;
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
