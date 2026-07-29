import { Image } from 'react-native';

import { modulePictograms } from '../module-pictograms';

export type RobotAssetProps = {
  /**
   * Display box. Locked sizes: 50 dp in the AI insight card, 38 dp in the bottom
   * navigation's centre control, 40 dp on the Noor AI module tile.
   */
  readonly size: number;
  readonly testID?: string;
};

/**
 * The approved NoorLife robot, rendered from `assets/images/pictograms/noor-ai.png`.
 *
 * This is the real approved asset, not a stand-in: `09-png-pictogram-system-preview.png`
 * specifies the same master for the module tile (40 dp) and the navigation centre
 * control (38 dp), so both use this one file.
 *
 * The lock forbids drawing the mascot with CSS or vector primitives, tinting it, or
 * substituting a vector glyph — so this component only ever sizes the PNG and fits it
 * with `contain`. No tint prop is exposed, deliberately.
 */
export function RobotAsset({ size, testID }: RobotAssetProps) {
  return (
    <Image
      source={modulePictograms.ai}
      style={{ width: size, height: size }}
      resizeMode="contain"
      accessible={false}
      testID={testID}
    />
  );
}
