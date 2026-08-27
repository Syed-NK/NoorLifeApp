import { createExpoReceiptSource } from '../receipts/expo-receipt-source';

/**
 * **The picker adapter: one permission per press, and no second way in** — issue #101.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Why the picker is injected rather than module-mocked ───────────────────
 * `createExpoReceiptSource` takes the picker as a parameter whose default is `expo-image-picker`.
 * That default is what production uses and what the source scan pins to this one file; the parameter
 * is what lets these cases state a permission answer and read back exactly which request was made.
 * A `jest.mock` of the module would test the same thing less directly and would load a native module
 * to do it.
 *
 * ── The property under test is an ordering, not a value ────────────────────
 * "The camera is requested only after Capture" is a claim about *when*, and the only structural way
 * to keep it is that requesting and opening are the same call. So these cases assert the sequence:
 * the permission request comes first, the launch comes second, and a refusal produces no launch at
 * all — a picker that opened after a denial would be an OS prompt the app could no longer explain.
 * ═══════════════════════════════════════════════════════════════════════════
 */

type Call = string;

function picker(options: {
  readonly camera?: { granted: boolean; canAskAgain?: boolean };
  readonly library?: { granted: boolean; canAskAgain?: boolean };
  readonly result?: unknown;
  readonly throws?: boolean;
}) {
  const calls: Call[] = [];
  const captured: unknown[] = [];
  const double = {
    requestCameraPermissionsAsync: async () => {
      calls.push('request:camera');
      await Promise.resolve();
      return { granted: true, canAskAgain: true, ...options.camera };
    },
    requestMediaLibraryPermissionsAsync: async () => {
      calls.push('request:library');
      await Promise.resolve();
      return { granted: true, canAskAgain: true, ...options.library };
    },
    launchCameraAsync: async (passed: unknown) => {
      calls.push('launch:camera');
      captured.push(passed);
      await Promise.resolve();
      if (options.throws === true) {
        throw new Error('no camera');
      }
      return options.result ?? { canceled: false, assets: [{ uri: 'file:///tmp/a.jpg' }] };
    },
    launchImageLibraryAsync: async (passed: unknown) => {
      calls.push('launch:library');
      captured.push(passed);
      await Promise.resolve();
      if (options.throws === true) {
        throw new Error('no picker');
      }
      return options.result ?? { canceled: false, assets: [{ uri: 'file:///tmp/b.jpg' }] };
    },
  };
  return { calls, captured, double };
}

describe('one press, one permission, one launch', () => {
  it('requests the camera and then opens it', async () => {
    const { calls, double } = picker({});

    const outcome = await createExpoReceiptSource(double as never).acquire('camera');

    expect(calls).toEqual(['request:camera', 'launch:camera']);
    expect(outcome).toEqual({ kind: 'acquired', uri: 'file:///tmp/a.jpg' });
  });

  it('requests the library and then opens it', async () => {
    const { calls, double } = picker({});

    const outcome = await createExpoReceiptSource(double as never).acquire('library');

    expect(calls).toEqual(['request:library', 'launch:library']);
    expect(outcome).toEqual({ kind: 'acquired', uri: 'file:///tmp/b.jpg' });
  });

  it('never requests the permission the other kind needs', async () => {
    const { calls, double } = picker({});
    const source = createExpoReceiptSource(double as never);

    await source.acquire('camera');

    expect(calls).not.toContain('request:library');
  });

  it('opens nothing when the permission is refused', async () => {
    const { calls, double } = picker({ camera: { granted: false, canAskAgain: true } });

    const outcome = await createExpoReceiptSource(double as never).acquire('camera');

    /* No launch after a denial: a picker that opened anyway would be a prompt with no explanation. */
    expect(calls).toEqual(['request:camera']);
    expect(outcome).toEqual({ kind: 'denied', retryable: true });
  });

  it('passes the platform through on whether asking again is possible', async () => {
    const { double } = picker({ library: { granted: false, canAskAgain: false } });

    expect(await createExpoReceiptSource(double as never).acquire('library')).toEqual({
      kind: 'denied',
      retryable: false,
    });
  });
});

describe('what the picker is asked for', () => {
  it('asks for one image, uncropped, with no base64 and no exif', async () => {
    const { captured, double } = picker({});

    await createExpoReceiptSource(double as never).acquire('camera');

    /*
      `base64` is the option that exists to make an image easy to put in a request body, and this
      workflow has no request body. `exif` would carry the GPS coordinates of where the photograph
      was taken into the app for no reason at all.
    */
    expect(captured[0]).toMatchObject({
      mediaTypes: ['images'],
      allowsEditing: false,
      allowsMultipleSelection: false,
      base64: false,
      exif: false,
    });
  });
});

describe('outcomes that are not an image', () => {
  it('reports a cancelled picker as cancelled, not as a failure', async () => {
    const { double } = picker({ result: { canceled: true } });

    expect(await createExpoReceiptSource(double as never).acquire('library')).toEqual({
      kind: 'cancelled',
    });
  });

  it.each([
    ['no assets', { canceled: false, assets: [] }],
    ['a null asset list', { canceled: false, assets: null }],
    ['an asset with no uri', { canceled: false, assets: [{}] }],
    ['an asset whose uri is not a string', { canceled: false, assets: [{ uri: 42 }] }],
    ['an empty uri', { canceled: false, assets: [{ uri: '' }] }],
  ])('reports %s as a failure rather than a cancellation', async (_label, result) => {
    const { double } = picker({ result });

    /*
      The distinction is what the user is told. "You backed out" is wrong when they did not, and it
      hides a picker that returned something unusable.
    */
    expect(await createExpoReceiptSource(double as never).acquire('library')).toEqual({
      kind: 'failed',
    });
  });

  it('reports a picker that throws as a failure and lets nothing escape', async () => {
    const { double } = picker({ throws: true });

    expect(await createExpoReceiptSource(double as never).acquire('camera')).toEqual({
      kind: 'failed',
    });
  });
});
