import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View } from 'react-native';

import { modulePalettes } from '@ds/tokens';
import { ModuleText } from '@features/modules/components';
import { moduleNeutrals, readerPageBackground } from '@features/modules/module-tokens';

/**
 * **The Qibla dial, in both of the screen's honest states.**
 *
 * ── Why this is built from primitives rather than an image ──────────────────
 * The dial is the one element on the screen that has to be *correct*, not merely decorative: a
 * marker sits at an angle derived from a live sensor, and a picture cannot rotate to an arbitrary
 * bearing. Everything here is therefore geometry — rings, ticks, cardinal letters, a star rose and a
 * marker — composed from views whose angles come from the model.
 *
 * The project has no SVG renderer, so every radial element uses the same construction: a full-size
 * absolutely-positioned box, `alignItems: 'center'`, rotated about its own centre. Whatever sits at
 * the top of that box swings around the circle, and the layout engine keeps it centred at any
 * diameter — where `sin`/`cos` offsets would need the element's own size folded into every
 * coordinate and re-derived whenever the dial resized.
 *
 * ── Why both states are drawn by the same parts ─────────────────────────────
 * Live and bearing-only are the same screen, and the brief requires that switching between them does
 * not move the furniture. Sharing the ring, its ticks and its diameter is what makes that true by
 * construction rather than by two layouts kept in step by hand.
 */

const EMERALD = modulePalettes.faith.primary;
const EMERALD_DEEP = modulePalettes.faith.dark;
const GOLD = modulePalettes.faith.supporting;
const NAVY = moduleNeutrals.textPrimary;

/** Ticks every 6°, with a longer one at each 30° — the density the approved dial draws. */
const TICK_COUNT = 60;
const MAJOR_EVERY = 5;

type Cardinal = { readonly label: string; readonly angle: number };

const CARDINALS: readonly Cardinal[] = [
  { label: 'N', angle: 0 },
  { label: 'E', angle: 90 },
  { label: 'S', angle: 180 },
  { label: 'W', angle: 270 },
];

const INTERCARDINALS: readonly Cardinal[] = [
  { label: 'NE', angle: 45 },
  { label: 'SE', angle: 135 },
  { label: 'SW', angle: 225 },
  { label: 'NW', angle: 315 },
];

/**
 * One radial slot.
 *
 * Everything angular on the dial goes through here so there is a single definition of "0° is up and
 * angles increase clockwise" — which is the convention the bearings themselves use, and the one place
 * a sign error would put every marker on the dial in the wrong quadrant at once.
 */
function Spoke({
  angle,
  children,
}: {
  readonly angle: number;
  readonly children: React.ReactNode;
}) {
  return <View style={[styles.spoke, { transform: [{ rotate: `${angle}deg` }] }]}>{children}</View>;
}

/**
 * The graduated band both states share.
 *
 * `inverted` swaps it from the live dial's filled emerald ring to the bearing-only dial's open cream
 * face with a gold edge. The geometry is identical either way, which is what stops the compass
 * jumping when the mode changes underneath it.
 */
function CompassRing({
  size,
  band,
  inverted,
}: {
  readonly size: number;
  readonly band: number;
  readonly inverted: boolean;
}) {
  const tickLong = band * 0.3;
  const tickShort = band * 0.18;

  return (
    <View style={[styles.fill, { borderRadius: size / 2, overflow: 'hidden' }]}>
      {inverted ? (
        <View
          style={[
            styles.fill,
            {
              borderRadius: size / 2,
              backgroundColor: readerPageBackground,
              borderWidth: 1.5,
              borderColor: GOLD,
            },
          ]}
        />
      ) : (
        <LinearGradient
          colors={[EMERALD, EMERALD_DEEP]}
          start={{ x: 0.2, y: 0 }}
          end={{ x: 0.8, y: 1 }}
          style={[styles.fill, { borderRadius: size / 2 }]}
        />
      )}

      {Array.from({ length: TICK_COUNT }, (_, index) => {
        const major = index % MAJOR_EVERY === 0;
        return (
          <Spoke key={index} angle={(index / TICK_COUNT) * 360}>
            <View
              style={{
                /*
                  Ticks occupy the *outer* part of the band and the cardinal letters sit inside them
                  — see `CardinalLetters`. Both were previously measured from the rim independently
                  and overlapped: on device the N, S, E and W were printed across the graduations.
                */
                marginTop: band * 0.18,
                width: major ? 2 : 1,
                height: major ? tickLong : tickShort,
                backgroundColor: GOLD,
                opacity: major ? 0.95 : 0.55,
              }}
            />
          </Spoke>
        );
      })}
    </View>
  );
}

/**
 * The cardinal letters, upright at every position.
 *
 * ── Why they are measured to sit *inside* the graduations ──────────────────
 * Letters and ticks were each positioned from the rim on their own, which read fine in the layout
 * numbers and collided on device: the N, S, E and W printed straight across the tick marks. The band
 * is now divided once — graduations in its outer part, letters immediately inside them — so the two
 * cannot drift into each other at any diameter.
 *
 * The counter-rotation is the whole point: a letter carried round on a rotated spoke arrives rotated
 * too, so `S` would print upside down and `E`/`W` on their sides. Turning it back by the same angle
 * puts it in the right place still the right way up.
 */
function CardinalLetters({
  size,
  band,
  points,
  color,
  fontSize,
}: {
  readonly size: number;
  readonly band: number;
  readonly points: readonly Cardinal[];
  readonly color: string;
  readonly fontSize: number;
}) {
  return (
    <View style={[styles.fill, { borderRadius: size / 2 }]} pointerEvents="none">
      {points.map((point) => (
        <Spoke key={point.label} angle={point.angle}>
          <View style={{ marginTop: band * 0.55, transform: [{ rotate: `${-point.angle}deg` }] }}>
            <ModuleText
              token="caption"
              color={color}
              style={{ fontSize, lineHeight: fontSize * 1.3 }}
            >
              {point.label}
            </ModuleText>
          </View>
        </Spoke>
      ))}
    </View>
  );
}

/**
 * The Kaaba, as a geometric mark rather than a photograph.
 *
 * Deliberately flat: the approved design's centrepiece is a rendered three-dimensional cube, which is
 * a raster asset this repository does not have. Drawing a recognisable Kaaba — the black cube, the
 * gold kiswah band, the door — from views is the honest interim, and it is the *shape* rather than an
 * impression of one. It is never presented as photography.
 */
export function KaabaMark({ size, testID }: { readonly size: number; readonly testID?: string }) {
  const band = Math.max(2, size * 0.14);

  return (
    <View
      style={{
        width: size,
        height: size * 0.92,
        borderRadius: Math.max(2, size * 0.06),
        backgroundColor: '#141414',
        overflow: 'hidden',
        justifyContent: 'center',
      }}
      testID={testID}
    >
      {/* The kiswah's embroidered band, two thirds up the face as it sits on the building. */}
      <View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: size * 0.24,
          height: band,
          backgroundColor: GOLD,
        }}
      />
      {/* The door. */}
      <View
        style={{
          position: 'absolute',
          right: size * 0.16,
          bottom: 0,
          width: size * 0.2,
          height: size * 0.4,
          backgroundColor: GOLD,
          opacity: 0.85,
        }}
      />
    </View>
  );
}

/**
 * The live dial: an emerald graduated ring, the Kaaba at rest in the middle, and one gold marker
 * that swings to wherever the Kaaba actually is relative to the top of the phone.
 *
 * ── What rotates, and why it is the marker rather than the ring ─────────────
 * Rotating the ring by `−heading` and leaving the marker fixed is the other common design, and it is
 * the one that makes people motion-sick — the whole dial swings as the phone trembles. Here the ring
 * is still and only the marker moves, so the marker points at the Kaaba relative to the top of the
 * phone. Less impressive, far easier to follow.
 */
export function QiblaLiveDial({
  size,
  markerAngle,
  aligned,
  testID,
}: {
  readonly size: number;
  /** Degrees clockwise from the top of the phone. Comes from the model, never from this component. */
  readonly markerAngle: number;
  readonly aligned: boolean;
  readonly testID: string;
}) {
  const band = size * 0.16;
  const inner = size - band * 2;

  return (
    <View style={{ width: size, height: size }} testID={testID}>
      <CompassRing size={size} band={band} inverted={false} />
      <CardinalLetters
        size={size}
        band={band}
        points={CARDINALS}
        color={GOLD}
        fontSize={size * 0.052}
      />

      {/* The face the Kaaba sits on. */}
      <View style={[styles.fill, styles.centre]} pointerEvents="none">
        <View
          style={{
            width: inner,
            height: inner,
            borderRadius: inner / 2,
            backgroundColor: readerPageBackground,
            borderWidth: 1,
            borderColor: aligned ? GOLD : `${GOLD}55`,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <KaabaMark size={inner * 0.3} testID={`${testID}-kaaba`} />
        </View>
      </View>

      {/*
        The marker. It carries a needle running out from the centre and an arrowhead riding the band,
        so the direction is readable both as a pointer and as a position on the graduated ring.
      */}
      <Spoke angle={markerAngle}>
        <View style={{ alignItems: 'center' }} testID={`${testID}-marker`}>
          <View
            style={{
              width: 0,
              height: 0,
              borderLeftWidth: band * 0.34,
              borderRightWidth: band * 0.34,
              borderBottomWidth: band * 0.62,
              borderLeftColor: 'transparent',
              borderRightColor: 'transparent',
              borderBottomColor: GOLD,
              marginTop: band * 0.18,
            }}
          />
          <View
            style={{
              width: Math.max(2, size * 0.012),
              height: inner * 0.34,
              backgroundColor: GOLD,
              opacity: aligned ? 1 : 0.9,
            }}
          />
        </View>
      </Spoke>
    </View>
  );
}

/**
 * The bearing-only dial: a north-up star rose with the Qibla drawn on it as a fixed ray.
 *
 * ── Why this looks different on purpose ─────────────────────────────────────
 * It is not the live dial with the tracking switched off; it is a *diagram*, and it has to read as
 * one at a glance. A user who cannot tell the two apart will hold the phone up and turn, which is
 * exactly the mistake the mode exists to prevent — so the rose is north-up, open and drawn rather
 * than instrument-like, and the ray never moves with the phone.
 */
export function QiblaBearingDial({
  size,
  bearing,
  testID,
}: {
  readonly size: number;
  /** Degrees clockwise from **true north**, not from the phone. Fixed by definition. */
  readonly bearing: number;
  readonly testID: string;
}) {
  const band = size * 0.13;
  const radius = size / 2;
  const longPoint = radius - band * 1.35;
  const shortPoint = longPoint * 0.62;

  return (
    <View style={{ width: size, height: size }} testID={testID}>
      <CompassRing size={size} band={band} inverted />
      <CardinalLetters
        size={size}
        band={band}
        points={CARDINALS}
        color={NAVY}
        fontSize={size * 0.055}
      />
      <CardinalLetters
        size={size}
        band={band}
        points={INTERCARDINALS}
        color={moduleNeutrals.textSecondary}
        fontSize={size * 0.038}
      />

      {/* The rose. Four long points on the cardinals, four short between them. */}
      <View style={[styles.fill, { borderRadius: size / 2 }]} pointerEvents="none">
        {[...CARDINALS, ...INTERCARDINALS].map((point, index) => {
          const long = index < CARDINALS.length;
          const length = long ? longPoint : shortPoint;
          return (
            <Spoke key={point.label} angle={point.angle}>
              <View
                style={{
                  width: 0,
                  height: 0,
                  marginTop: radius - length,
                  borderLeftWidth: length * 0.16,
                  borderRightWidth: length * 0.16,
                  borderBottomWidth: length,
                  borderLeftColor: 'transparent',
                  borderRightColor: 'transparent',
                  borderBottomColor: long ? EMERALD_DEEP : EMERALD,
                }}
              />
            </Spoke>
          );
        })}
      </View>

      {/*
        The Qibla ray. Fixed to the bearing from true north — it does not track the phone, which is
        the entire claim this mode makes.
      */}
      <Spoke angle={bearing}>
        <View style={{ alignItems: 'center' }} testID={`${testID}-ray`}>
          <View
            style={{
              width: 0,
              height: 0,
              borderLeftWidth: band * 0.36,
              borderRightWidth: band * 0.36,
              borderBottomWidth: band * 0.7,
              borderLeftColor: 'transparent',
              borderRightColor: 'transparent',
              borderBottomColor: GOLD,
              marginTop: band * 0.2,
            }}
          />
          <View
            style={{
              width: Math.max(2, size * 0.014),
              height: radius - band * 1.5,
              backgroundColor: GOLD,
            }}
          />
        </View>
      </Spoke>

      {/* The Kaaba badge, riding the ray so the diagram says *what* the ray points at. */}
      <Spoke angle={bearing}>
        <View
          style={{
            marginTop: band * 1.05,
            width: size * 0.13,
            height: size * 0.13,
            borderRadius: size * 0.065,
            backgroundColor: readerPageBackground,
            borderWidth: 1,
            borderColor: GOLD,
            alignItems: 'center',
            justifyContent: 'center',
            transform: [{ rotate: `${-bearing}deg` }],
          }}
        >
          <KaabaMark size={size * 0.068} />
        </View>
      </Spoke>

      {/* The rose's hub, drawn last so the points meet under it. */}
      <View style={[styles.fill, styles.centre]} pointerEvents="none">
        <View
          style={{
            width: size * 0.1,
            height: size * 0.1,
            borderRadius: size * 0.05,
            backgroundColor: readerPageBackground,
            borderWidth: 2,
            borderColor: GOLD,
          }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  centre: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  spoke: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    // Top-centre, so rotating this box about its centre carries its child around the dial.
    alignItems: 'center',
  },
});
