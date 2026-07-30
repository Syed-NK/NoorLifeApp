import { Text, type TextProps, type TextStyle } from 'react-native';

import { fontFamilies } from '@ds/tokens';

import { moduleNeutrals, type ModuleTypeToken } from '../module-tokens';
import { useModuleMetrics } from '../use-module-metrics';

/**
 * Which Poppins face each token uses.
 *
 * SemiBold is the heaviest weight in the app. Main Home's review established that
 * Bold and above read as shouting at these sizes, and module screens must match.
 */
const FACE: Record<ModuleTypeToken, keyof typeof fontFamilies> = {
  headerTitle: 'semiBold',
  heroTitle: 'semiBold',
  heroDisplay: 'semiBold',
  faithPrayer: 'semiBold',
  heroScore: 'semiBold',
  heroBody: 'regular',
  eyebrow: 'medium',
  sectionTitle: 'semiBold',
  sectionAction: 'medium',
  cardHeading: 'semiBold',
  cardAction: 'medium',
  rowLabel: 'regular',
  rowMeta: 'regular',
  metricValue: 'semiBold',
  chartAxis: 'regular',
  cardTitle: 'semiBold',
  body: 'regular',
  caption: 'regular',
  arabic: 'regular',
  metric: 'semiBold',
  metricUnit: 'medium',
  tileLabel: 'medium',
  quickAction: 'medium',
  navLabel: 'medium',
  button: 'semiBold',
  stateTitle: 'semiBold',
  stateBody: 'regular',
  banner: 'regular',
};

/** Tokens whose default colour is the supporting grey rather than primary text. */
const SECONDARY_BY_DEFAULT: ReadonlySet<ModuleTypeToken> = new Set<ModuleTypeToken>([
  'heroBody',
  'eyebrow',
  'body',
  'caption',
  'metricUnit',
  'stateBody',
  'rowMeta',
  'chartAxis',
]);

export type ModuleTextProps = TextProps & {
  readonly token: ModuleTypeToken;
  readonly color?: string;
  readonly align?: TextStyle['textAlign'];
};

/**
 * Text for every module screen.
 *
 * Face, size, line height and default colour all resolve from one token, so no
 * module screen sets a `fontFamily` or a raw size. That is what keeps the type ramp
 * a property of the system rather than something to re-check at each call site.
 *
 * `allowFontScaling` stays at its default of true. Module screens must honour the
 * OS text size; where a control's geometry cannot absorb unlimited growth, the call
 * site caps the multiplier rather than switching scaling off.
 */
export function ModuleText({ token, color, align, style, ...rest }: ModuleTextProps) {
  const { type } = useModuleMetrics();
  const { fontSize, lineHeight } = type(token);

  const defaultColor = SECONDARY_BY_DEFAULT.has(token)
    ? moduleNeutrals.textSecondary
    : moduleNeutrals.textPrimary;

  return (
    <Text
      style={[
        {
          fontFamily: fontFamilies[FACE[token]],
          fontSize,
          lineHeight,
          color: color ?? defaultColor,
          textAlign: align,
        },
        style,
      ]}
      {...rest}
    />
  );
}
