import {
  faithPictograms,
  type FaithPictogramEntry,
  type FaithPictogramId,
} from '../faith-pictogram-assets';

import { FaithDevAudit, type FaithDevAuditRow } from './faith-dev-audit';

/**
 * Which pictogram slots on this screen are not drawing their artwork, and why.
 *
 * ── Why this is not a doc, a TODO or a log line ─────────────────────────────
 * `docs/FAITH_ASSET_GAPS.md` already records the gaps and has recorded some of them since Phase 4,
 * which is the evidence that a document is not what stops a stand-in shipping. A screenshot is what
 * gets reviewed and approved, so the statement has to be *in* the screenshot.
 *
 * ── Two kinds of not-drawn, reported differently ────────────────────────────
 * `awaiting-artwork` is a gap: somebody still owes a PNG, and the panel flags it. `held` is a
 * decision: the artwork exists and is deliberately not rendered because the feature behind it is
 * incomplete. Reporting them with the same wording would turn a considered choice into what looks
 * like an outstanding chore — and the obvious way to clear a chore is to install the asset, which is
 * precisely what must not happen to P3.
 *
 * So held slots are stated, not flagged. Nothing about them needs fixing.
 *
 * Renders nothing in a production bundle — the `__DEV__` guard is inside `FaithDevAudit`, which is
 * the single place it is checked.
 */
export function FaithPictogramDevAudit({
  slots,
  testID,
}: {
  /** The slots this screen occupies, so each screen reports its own rather than all sixteen. */
  readonly slots: readonly FaithPictogramId[];
  readonly testID: string;
}) {
  const mine = faithPictograms.filter((entry) => slots.includes(entry.id));
  const awaiting = mine.filter((entry) => entry.asset.status === 'awaiting-artwork');
  const held = mine.filter((entry) => entry.asset.status === 'held');

  const heldRow = (entry: FaithPictogramEntry): FaithDevAuditRow => ({
    key: `held-${entry.id}`,
    label: `${entry.id.toUpperCase()} — ${entry.subject}`,
    // The exact wording the decision record uses, so the screen and the doc cannot drift.
    value: 'Held pending notification delivery.',
    flagged: false,
  });

  const awaitingRow = (entry: FaithPictogramEntry): FaithDevAuditRow => ({
    key: `awaiting-${entry.id}`,
    label: `${entry.id.toUpperCase()} — ${entry.subject}`,
    /*
      The filename rather than "missing": it is the thing a reader needs in order to act, and it
      names the slot's destination without their having to open the registry.
    */
    value: entry.file,
    flagged: true,
  });

  const rows: readonly FaithDevAuditRow[] =
    awaiting.length === 0 && held.length === 0
      ? [
          {
            key: 'none',
            label: 'Every slot on this screen renders its approved PNG',
            value: 'ok',
          },
        ]
      : [...awaiting.map(awaitingRow), ...held.map(heldRow)];

  return (
    <FaithDevAudit
      title="pictogram slots"
      note={
        awaiting.length > 0
          ? 'These slots render a temporary stand-in, NOT the approved NoorLife pictogram. Not visually approved.'
          : held.length > 0
            ? 'Approved artwork everywhere except the held slot below, which is withheld on purpose.'
            : 'No temporary artwork on this screen.'
      }
      rows={rows}
      testID={testID}
    />
  );
}
