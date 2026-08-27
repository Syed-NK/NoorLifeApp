import { FinanceReceiptsScreen } from '@features/finance/screens/finance-receipts-screen';
import { createExpoReceiptSource } from '@features/finance/receipts/expo-receipt-source';
import { createDeviceReceiptOcr } from '@features/finance/receipts/device-receipt-ocr';

/**
 * Finance → Receipts. **Not a reachable capability yet** — issue #101.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Why the route exists while the tile does not ───────────────────────────
 * The Receipts capability in the registry is still `available: false`, so no Finance surface links
 * here: the feature grid renders it as an unavailable tile with a neutral glyph, exactly as it did
 * before this branch. What this file adds is a destination that a developer can open directly and a
 * deterministic test can render — which is what makes the workflow verifiable on a device *before*
 * it is promised to anybody.
 *
 * The remaining gate is physical-iPhone runtime verification, which needs a paid Apple Developer
 * Program membership this project does not have. An EAS iOS Simulator build proves the native
 * dependencies compile and link; it proves nothing about a camera. Until the iPhone side is
 * verified, `available` stays false, the commissioned Receipts pictogram stays outside the
 * repository, and `finance-icon-assets.ts` keeps its note explaining why.
 *
 * ── This route is not a hole in the gates ──────────────────────────────────
 * It sits inside `app/finance/`, so `_layout.tsx` wraps it in `ProtectedRouteBoundary` and then
 * `ModuleEntitlementGate` — the same two questions, in the same order, that every other Finance
 * route answers. A direct link here from a signed-out or unentitled session reaches the same
 * boundary it would reach at `/finance/budgets`.
 *
 * And it reads no session of its own. An earlier draft of this file called `useAuth` to work out
 * which account a kept receipt image belongs to, which `protected-route-boundary`'s own scan
 * correctly refused: a route that consults the session is a second boundary with its own opinion,
 * the shape of the divergence issue #28 describes. The owner now comes from the Finance provider,
 * which takes it from the repository — so the directory a receipt is kept in is named for exactly
 * the account the transaction was written under, and there is no second answer to disagree with.
 *
 * ── Where the native packages are wired ────────────────────────────────────
 * Here, and nowhere else. The screen takes both ports as props, so the recogniser and the picker are
 * imported by one file that no test renders — which is what keeps the Finance feature tree free of
 * native imports and lets every test drive the workflow with stated doubles instead of a mocked SDK.
 *
 * The recogniser is `modules/noorlife-text-recognition`, this repository’s own Expo module: bundled
 * Latin ML Kit on Android, Apple Vision on iOS. It replaced a community package that declared all
 * five OCR scripts on both platforms with no way to ask for one — see the adapter for the
 * measurements.
 *
 * Built once at module scope rather than per render: they are stateless adapters, and a new object
 * every render would re-arm every effect that depends on them.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const ocr = createDeviceReceiptOcr();
const source = createExpoReceiptSource();

export default function Screen() {
  return <FinanceReceiptsScreen ocr={ocr} source={source} />;
}
