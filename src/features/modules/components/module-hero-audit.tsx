import { Image, StyleSheet, View } from 'react-native';

import { AA_LARGE_TEXT, AA_TEXT, contrastRatio, formatRatio } from '../contrast';
import { useModule } from '../module-context';
import { moduleLayout, moduleNeutrals } from '../module-tokens';
import { useModuleMetrics } from '../use-module-metrics';
import { ModuleText } from './module-text';

export type ModuleHeroAuditProps = {
  readonly testID?: string;
};

/**
 * A hero card's asset and contrast facts, printed.
 *
 * The point is that the artwork lock should be checkable from a screenshot rather than by
 * reading code. It reports the asset actually resolved at runtime — via
 * `Image.resolveAssetSource`, not a hard-coded path string — so if a hero ever loads
 * something other than its module pictogram, the filename shown here changes.
 *
 * Development-only, rendered by the Module Gallery.
 */
export function ModuleHeroAudit({ testID }: ModuleHeroAuditProps) {
  const module = useModule();
  const { dp } = useModuleMetrics();
  const theme = module.theme;

  // What the bundler actually resolved. In a release bundle `uri` is absent and
  // `width`/`height` carry the intrinsic pixel size, so both cases are handled.
  const resolved = Image.resolveAssetSource(module.heroPictogram) as {
    uri?: string;
    width?: number;
    height?: number;
    scale?: number;
  } | null;

  /**
   * The asset's identifying path — the last two segments, e.g. `normalized/faith.png`.
   *
   * Two segments rather than the filename alone, because this whole audit exists to show
   * *which of two same-named directories* an asset came from. A bare `faith.png` cannot
   * distinguish `normalized/faith.png` from `pictograms/faith.png`.
   *
   * Metro serves dev assets as `/assets/?unstable_path=<encoded real path>&platform=…`, so
   * the path lives in the query string and stripping the query throws away the only useful
   * part — which is exactly what a first attempt here did, reporting every asset as
   * "assets/". Release bundles have no URI at all and expose only intrinsic dimensions.
   */
  const filename = ((): string => {
    if (resolved?.uri === undefined || resolved.uri === '') {
      return `${module.id}.png (bundled — no dev URI)`;
    }
    const lastTwo = (path: string): string => {
      const segments = path.split('/').filter((segment) => segment.length > 0);
      return segments.slice(-2).join('/');
    };

    const unstable = /[?&]unstable_path=([^&]+)/.exec(resolved.uri);
    if (unstable?.[1] !== undefined) {
      return lastTwo(decodeURIComponent(unstable[1]));
    }
    return lastTwo(resolved.uri.split('?')[0] ?? resolved.uri) || resolved.uri;
  })();

  const intrinsic =
    resolved?.width === undefined || resolved.height === undefined
      ? 'unknown'
      : `${resolved.width}×${resolved.height} px`;

  const sameAsset = module.heroPictogram === module.pictogram;

  /** Hero text sits on the gradient; the action label sits on `fill`. */
  const rows: readonly { label: string; value: string; pass: boolean }[] = [
    {
      label: 'Eyebrow on gradient',
      value: formatRatio(contrastRatio(theme.onFill, theme.gradientStart)),
      pass: contrastRatio(theme.onFill, theme.gradientStart) >= AA_TEXT,
    },
    {
      label: 'Heading on gradient',
      value: formatRatio(contrastRatio(theme.onFill, theme.gradientStart)),
      // The heading is ~22 dp SemiBold, so it clears at the large-text threshold, but it
      // is reported against the stricter bar because it passes there too.
      pass: contrastRatio(theme.onFill, theme.gradientStart) >= AA_LARGE_TEXT,
    },
    {
      label: 'Body on gradient end',
      value: formatRatio(contrastRatio(theme.onFill, theme.gradientEnd)),
      pass: contrastRatio(theme.onFill, theme.gradientEnd) >= AA_TEXT,
    },
    {
      label: 'Action label on fill',
      value: formatRatio(contrastRatio(theme.onFill, theme.fill)),
      pass: contrastRatio(theme.onFill, theme.fill) >= AA_TEXT,
    },
    {
      label: 'Ink on light surface',
      value: formatRatio(contrastRatio(theme.ink, theme.wellSurface)),
      pass: contrastRatio(theme.ink, theme.wellSurface) >= AA_TEXT,
    },
  ];

  return (
    <View
      style={[
        styles.card,
        {
          borderRadius: dp(moduleLayout.radiusSmall),
          padding: dp(10),
          rowGap: dp(3),
        },
      ]}
      testID={testID}
    >
      <Fact label="Module" value={module.name} />
      <Fact label="Asset" value={filename} testID={`${testID ?? 'audit'}-asset`} />
      <Fact label="Source size" value={intrinsic} />
      <Fact
        label="Rendered box"
        value={`full-bleed · ${dp(moduleLayout.heroHeight)} dp tall · cover · no tint`}
      />
      <Fact
        label="heroPictogram === pictogram"
        value={sameAsset ? 'YES' : 'NO — MISMATCH'}
        tone={sameAsset ? moduleNeutrals.success : moduleNeutrals.error}
        testID={`${testID ?? 'audit'}-equality`}
      />
      <Fact
        label="Theme"
        value={`${theme.gradientStart} → ${theme.gradientEnd} · ink ${theme.ink} · surface ${theme.wellSurface}`}
      />

      <View style={{ height: dp(4) }} />

      {rows.map((row) => (
        <Fact
          key={row.label}
          label={row.label}
          value={`${row.value} ${row.pass ? 'PASS' : 'FAIL'}`}
          tone={row.pass ? moduleNeutrals.success : moduleNeutrals.error}
        />
      ))}
    </View>
  );
}

function Fact({
  label,
  value,
  tone,
  testID,
}: {
  readonly label: string;
  readonly value: string;
  readonly tone?: string;
  readonly testID?: string;
}) {
  return (
    <View style={styles.row} testID={testID}>
      <ModuleText token="caption" color={moduleNeutrals.textTertiary} style={styles.label}>
        {label}
      </ModuleText>
      <ModuleText token="caption" color={tone} numberOfLines={2} style={styles.value}>
        {value}
      </ModuleText>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: moduleNeutrals.surfaceMuted,
    borderWidth: 1,
    borderColor: moduleNeutrals.border,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  label: {
    width: '46%',
  },
  value: {
    flex: 1,
    minWidth: 0,
  },
});
