import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import * as XLSX from 'xlsx';
import { recomputeConsensus, filterCandidatesByThreshold, DEFAULT_DE_THRESHOLD as SHARED_DEFAULT_DE } from '../utils/allocation';

const DEFAULT_DE_THRESHOLD = SHARED_DEFAULT_DE;
const DE_MIN = 0.1;
const DE_MAX = 2.0;
const DE_STEP = 0.1;
const DE_PRESETS = [0.1, 0.5, 1.0, 1.5, 2.0];
const formatMetric3 = (v) => (Number.isFinite(v) ? Number(v).toFixed(2) : '-');
const formatTests = (tests = []) => (Array.isArray(tests) && tests.length ? tests.join(', ') : 'none');
const lotTestMeta = (item = {}) => {
  const match = item.matchMethodId || item.matchedTestMethodId || item.methodId || '-';
  const tests = formatTests(item.availableTests);
  const superLabel = item.isSuperLot ? ' - super lot' : '';
  return `match ${match} - tests ${tests}${superLabel}`;
};

const statusMeta = (status, isPartialPrior, decision) => {
  if (!decision && status === 'pending') return { key: 'pending', label: 'Awaiting decision' };
  if (decision === 'none') return { key: 'skipped', label: 'Skipped' };
  if (status === 'full') return { key: 'full', label: 'Will fulfill' };
  if (status === 'partial') return { key: 'partial', label: 'Partial fill' };
  if (status === 'unfulfilled' && decision) return { key: 'unfulfilled', label: 'Cannot fulfill' };
  if (status === 'unfulfilled') return { key: 'unfulfilled', label: 'No stock match' };
  if (status === 'unsupported') return { key: 'unsupported', label: 'Unsupported' };
  return { key: 'pending', label: 'Pending' };
};

function clusterGroups(lines) {
  const order = [];
  const map = new Map();
  lines.forEach(l => {
    const k = l.invoiceNumber || `__${l.invoiceLineId}`;
    if (!map.has(k)) {
      const g = { invoiceNumber: l.invoiceNumber || k, lines: [] };
      map.set(k, g);
      order.push(g);
    }
    map.get(k).lines.push(l);
  });
  return order;
}

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
function assignInvoiceHues(lines) {
  const counts = new Map();
  lines.forEach(l => {
    if (!l.invoiceNumber) return;
    counts.set(l.invoiceNumber, (counts.get(l.invoiceNumber) || 0) + 1);
  });
  const out = {};
  counts.forEach((n, inv) => {
    if (n > 1) out[inv] = hashStr(inv) % 360;
  });
  return out;
}

/* ---------------- Modal shell ---------------- */

function Modal({ open, onClose, title, subtitle, children, size = 'md', bodyClassName = '', headerExtra = null }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className={`modal modal-${size}`} onClick={(e) => e.stopPropagation()} role="dialog">
        <div className="modal-head">
          <div>
            <div className="modal-title">{title}</div>
            {subtitle && <div className="modal-subtitle">{subtitle}</div>}
          </div>
          <div className="modal-head-actions">
            {headerExtra}
            <button className="modal-close" type="button" onClick={onClose} aria-label="Close">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" />
              </svg>
            </button>
          </div>
        </div>
        <div className={`modal-body ${bodyClassName}`}>{children}</div>
      </div>
    </div>,
    document.body
  );
}

/* ---------------- Requirement row (compact) ---------------- */

function InvoiceRow({ line, allocRow, decision, invoiceHue, onApply, onSkip, onUndo, onOpen }) {
  const status = allocRow?.coverageStatus || (line.isSupported ? 'pending' : 'unsupported');
  const meta = statusMeta(status, line.isPartiallyFulfilled, decision);
  const haloClass = `halo-${meta.key}`;
  const canApply = line.isSupported && allocRow?.recommendedAction && allocRow.recommendedAction !== 'none';
  const isApplied = decision === 'full' || decision === 'partial';
  const isSkipped = decision === 'none';

  const recAvail = allocRow?.availableCandidateQtyMt || 0;
  const requested = allocRow?.qtyRequestedMt || line.qtyMt || 0;
  const allocated = allocRow?.qtyAllocatedMt || 0;

  return (
    <div className={`inv-card ${haloClass}${Number.isFinite(invoiceHue) ? ' inv-card-grouped' : ''}`}>
      <div className="inv-card-body" onClick={onOpen} role="button">
        <div className="inv-card-head">
          <span className="inv-card-customer" title={line.customerName}>{line.customerName}</span>
          <span className="inv-card-chip">{line.invoiceNumber}</span>
        </div>

        <div className="inv-card-sub">
          <span>{line.application || 'no app'}</span>
          {line.isPartiallyFulfilled && <span className="inv-card-tag">carried</span>}
        </div>

        <div className="inv-card-qty">
          <strong>{(isApplied ? allocated : requested).toFixed(1)}</strong>
          <span className="unit">/ {requested.toFixed(1)} MT</span>
        </div>

        <div className="inv-card-meta">
          <span className={`pill ${meta.key}`}>{meta.label}</span>
          <span className="inv-card-meta-sub">
            {isApplied
              ? `${allocated.toFixed(1)} draws`
              : `${recAvail.toFixed(1)} avail`}
          </span>
        </div>
      </div>

      <div className="inv-card-actions">
        {!isApplied && !isSkipped && (
          <>
            <button
              className="btn btn-sm btn-primary"
              disabled={!canApply}
              onClick={() => onApply(line.invoiceLineId, allocRow.recommendedAction)}
              type="button"
            >
              {allocRow?.recommendedAction === 'full' ? 'Fulfill' : allocRow?.recommendedAction === 'partial' ? 'Partial' : "Can't"}
            </button>
            {line.isSupported && (
              <button className="btn btn-sm btn-ghost" onClick={() => onSkip(line.invoiceLineId)} type="button">Skip</button>
            )}
          </>
        )}
        {(isApplied || isSkipped) && (
          <button className="btn btn-sm btn-secondary" onClick={() => onUndo(line.invoiceLineId)} type="button">Undo</button>
        )}
      </div>
    </div>
  );
}

/* ---------------- Requirement detail modal contents ---------------- */

function InvoiceDetail({
  line,
  allocRow,
  baselineAllocRow,
  candidates,
  decision,
  dEOverride,
  onApply,
  onSkip,
  onUndo,
  onClose,
  onSetDeThreshold,
  onClearDeThreshold,
  previewWithThreshold,
}) {
  const status = allocRow?.coverageStatus || (line.isSupported ? 'pending' : 'unsupported');
  const meta = statusMeta(status, line.isPartiallyFulfilled, decision);

  const activeThreshold = Number.isFinite(allocRow?.dEThreshold) ? allocRow.dEThreshold : DEFAULT_DE_THRESHOLD;
  const isOverridden = Number.isFinite(dEOverride) && Math.abs(dEOverride - DEFAULT_DE_THRESHOLD) > 1e-9;
  const [pendingThreshold, setPendingThreshold] = useState(activeThreshold);
  const [confirmOpen, setConfirmOpen] = useState(false);
  useEffect(() => { setPendingThreshold(activeThreshold); }, [activeThreshold, line.invoiceLineId]);

  const dirty = Math.abs(pendingThreshold - activeThreshold) > 1e-9;
  const isApplied = decision === 'full' || decision === 'partial';
  const isSkipped = decision === 'none';

  // Live preview: rerank+filter recommended list against the slider's current value
  // (pending) once the line is applied; otherwise use the active threshold.
  const previewActiveThreshold = isApplied ? pendingThreshold : activeThreshold;
  const livePreviewRow = useMemo(() => {
    if (!isApplied || !dirty || !previewWithThreshold) return null;
    return previewWithThreshold(line.invoiceLineId, pendingThreshold);
  }, [isApplied, dirty, previewWithThreshold, line.invoiceLineId, pendingThreshold]);
  const displayAllocRow = livePreviewRow || allocRow;
  const requested = displayAllocRow?.qtyRequestedMt || line.qtyMt || 0;
  const allocated = displayAllocRow?.qtyAllocatedMt || 0;
  const shortfall = displayAllocRow?.shortfallMt || 0;
  const recommended = useMemo(
    () => recomputeConsensus(filterCandidatesByThreshold(candidates, previewActiveThreshold)),
    [candidates, previewActiveThreshold]
  );
  const recommendedLotSet = useMemo(() => new Set(recommended.map(c => c.lotNo)), [recommended]);
  const others = (candidates || []).filter(c => !recommendedLotSet.has(c.lotNo));
  const canApply = line.isSupported && allocRow?.recommendedAction && allocRow.recommendedAction !== 'none';
  const candidateQty = (candidate) => candidate?.simulatedAvailableQtyMt ?? candidate?.availableQtyMt ?? 0;

  const doApply = () => { onApply(line.invoiceLineId, allocRow.recommendedAction); };
  const doSkip = () => { onSkip(line.invoiceLineId); onClose(); };
  const doUndo = () => { onUndo(line.invoiceLineId); };

  const onSliderChange = (e) => setPendingThreshold(Number(e.target.value));
  const previewThreshold = () => setConfirmOpen(true);
  const cancelOverride = () => { setPendingThreshold(activeThreshold); };
  const resetToDefault = () => {
    onClearDeThreshold?.(line.invoiceLineId);
    setPendingThreshold(DEFAULT_DE_THRESHOLD);
  };
  const confirmThreshold = () => {
    onSetDeThreshold?.(line.invoiceLineId, pendingThreshold);
    setConfirmOpen(false);
  };

  return (
    <>
      <div className="md-summary">
        <div className="md-summary-row">
          <div>
            <div className="md-label">Customer</div>
            <div className="md-value">{line.customerName}</div>
          </div>
          <div>
            <div className="md-label">Requirement</div>
            <div className="md-value">{line.invoiceNumber}</div>
          </div>
          <div>
            <div className="md-label">Status</div>
            <div className="md-value"><span className={`pill ${meta.key}`}>{meta.label}</span></div>
          </div>
          <div>
            <div className="md-label">Match test</div>
            <div className="md-value">{line.resolvedMethodId}</div>
          </div>
        </div>
        <div className="md-summary-row">
          <div><div className="md-label">Outstanding</div><div className="md-value">{requested.toFixed(2)} MT</div></div>
          <div><div className="md-label">Will allocate</div><div className="md-value">{allocated.toFixed(2)} MT</div></div>
          <div><div className="md-label">Shortfall</div><div className="md-value">{shortfall.toFixed(2)} MT</div></div>
          <div>
            <div className="md-label">Customer required tests</div>
            <div className="md-value md-value-wrap">{line.targetMethodId ? line.targetMethodId.split(/[,;|]+/).map(s => s.trim()).filter(Boolean).join(', ') : 'none'}</div>
          </div>
        </div>
      </div>

      {!line.isSupported && line.supportReason && (
        <div className="md-callout bad">{line.supportReason}</div>
      )}

      {displayAllocRow?.allocations?.length > 0 && (
        <>
          <div className="md-section-title">Allocated lots ({displayAllocRow.allocations.length})</div>
          <div className="md-lot-list">
            {displayAllocRow.allocations.map((a, idx) => {
              const dynMatch = recommended.find(r => r.lotNo === a.lotNo);
              const dyn = dynMatch?.dynamicConsensusRank ?? a.consensusRank;
              const baseRank = a.consensusRank;
              const sliderActive = Math.abs(previewActiveThreshold - DEFAULT_DE_THRESHOLD) > 1e-9;
              const rankChanged = sliderActive && Number.isFinite(dyn) && Number.isFinite(baseRank) && dyn !== baseRank;
              return (
                <div className="md-lot" key={idx}>
                  <div className="md-lot-rank">#{dyn || idx + 1}</div>
                  <div className="md-lot-mid">
                    <div className="md-lot-no">{a.lotNo}</div>
                    <div className="md-lot-meta">
                      dE {formatMetric3(a.euclideanDeltaE)} - knn {formatMetric3(a.knnDistance)} - consensus #{dyn ?? '-'}
                      {rankChanged && <span className="md-rank-was"> (was #{baseRank})</span>}
                    </div>
                    <div className="md-lot-meta">{lotTestMeta(a)}</div>
                  </div>
                  <span className={`pp-top-pick-badge ${a.perceptual?.key || 'unknown'}`}>{a.perceptual?.label || 'unknown'}</span>
                  <span className="md-lot-qty">{a.allocatedQtyMt?.toFixed(2)} MT</span>
                </div>
              );
            })}
          </div>
        </>
      )}

      <div className="md-section-title">
        <span>Recommended lots</span>
        {!isApplied && (
          <span className="md-section-sub">filtered by dE threshold - reranked by consensus</span>
        )}
      </div>

      {isApplied && (
        <div className="de-slider-row">
          <div className="de-slider-lead">
            <span className="de-slider-lbl">Adjust dE threshold</span>
            <span className="de-slider-val">{pendingThreshold.toFixed(1)}</span>
          </div>
          <div className="de-slider-wrap">
            <div className="de-tick-row" aria-hidden="true">
              {DE_PRESETS.map(p => {
                const pct = ((p - DE_MIN) / (DE_MAX - DE_MIN)) * 100;
                const isDefault = Math.abs(p - DEFAULT_DE_THRESHOLD) < 1e-9;
                return (
                  <span
                    key={p}
                    className={`de-tick${isDefault ? ' is-default' : ''}`}
                    style={{ left: `${pct}%` }}
                  >
                    <span className="de-tick-lbl">{p}</span>
                    <span className="de-tick-mark" />
                  </span>
                );
              })}
            </div>
            <input
              type="range"
              className="de-range"
              min={DE_MIN}
              max={DE_MAX}
              step={DE_STEP}
              value={pendingThreshold}
              onChange={onSliderChange}
              aria-label="dE threshold"
            />
          </div>
          <div className="de-slider-tail">
            {dirty && (
              <>
                <button type="button" className="btn btn-sm btn-ghost" onClick={cancelOverride}>Cancel</button>
                <button type="button" className="btn btn-sm btn-primary" onClick={previewThreshold}>Preview</button>
              </>
            )}
            {!dirty && isOverridden && (
              <button type="button" className="btn btn-sm btn-ghost" onClick={resetToDefault}>Reset</button>
            )}
          </div>
        </div>
      )}


      {recommended.length === 0 ? (
        <div className="md-callout muted">No lot in stock has dE within {previewActiveThreshold.toFixed(1)} for this line.</div>
      ) : (
        <div className="md-lot-list">
          {recommended.map(c => {
            const dyn = c.dynamicConsensusRank ?? c.consensusRank;
            const baseRank = c.consensusRank;
            const sliderActive = Math.abs(previewActiveThreshold - DEFAULT_DE_THRESHOLD) > 1e-9;
            const rankChanged = sliderActive && Number.isFinite(dyn) && Number.isFinite(baseRank) && dyn !== baseRank;
            return (
              <div className="md-lot" key={c.lotNo}>
                <div className="md-lot-rank">#{dyn ?? '-'}</div>
                <div className="md-lot-mid">
                  <div className="md-lot-no">{c.lotNo}</div>
                  <div className="md-lot-meta">
                    dE {formatMetric3(c.euclideanDeltaE)} - cosine {formatMetric3(c.cosineSimilarity)} - knn {formatMetric3(c.knnDistance)} - consensus #{dyn ?? '-'}
                    {rankChanged && <span className="md-rank-was"> (was #{baseRank})</span>}
                  </div>
                  <div className="md-lot-meta">{lotTestMeta(c)}</div>
                </div>
                <span className={`pp-top-pick-badge ${c.perceptual?.key || 'unknown'}`}>{c.perceptual?.label || 'unknown'}</span>
                <span className="md-lot-qty">{candidateQty(c).toFixed(2)} MT</span>
              </div>
            );
          })}
        </div>
      )}

      {others.length > 0 && (
        <details className="md-collapse">
          <summary>Show {others.length} excluded candidate(s)</summary>
          <div className="md-lot-list">
            {[...others]
              .sort((a, b) => (a.consensusRank ?? 9999) - (b.consensusRank ?? 9999))
              .slice(0, 20)
              .map((c, idx) => {
                const seqRank = recommended.length + idx + 1;
                return (
                  <div className="md-lot dim" key={`x-${c.lotNo}`}>
                    <div className="md-lot-rank">#{seqRank}</div>
                    <div className="md-lot-mid">
                      <div className="md-lot-no">{c.lotNo}</div>
                      <div className="md-lot-meta">dE {formatMetric3(c.euclideanDeltaE)} - cosine {formatMetric3(c.cosineSimilarity)} - knn {formatMetric3(c.knnDistance)} - consensus #{seqRank}</div>
                      <div className="md-lot-meta">{lotTestMeta(c)}</div>
                    </div>
                    <span className={`pp-top-pick-badge ${c.perceptual?.key || 'unknown'}`}>{c.perceptual?.label || 'unknown'}</span>
                  </div>
                );
              })}
          </div>
        </details>
      )}

      <div className="md-actions">
        {!isApplied && !isSkipped && (
          <>
            <button className="btn btn-primary" disabled={!canApply} onClick={doApply} type="button">
              {allocRow?.recommendedAction === 'full' ? 'Fulfill from stock' : allocRow?.recommendedAction === 'partial' ? 'Partially fulfill' : "Can't fulfill"}
            </button>
            {line.isSupported && (
              <button className="btn btn-ghost" onClick={doSkip} type="button">Skip this requirement</button>
            )}
          </>
        )}
        {(isApplied || isSkipped) && (
          <button className="btn btn-secondary" onClick={doUndo} type="button">Undo decision</button>
        )}
      </div>

      <ThresholdConfirmModal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={confirmThreshold}
        line={line}
        oldRow={allocRow}
        newRow={previewWithThreshold ? previewWithThreshold(line.invoiceLineId, pendingThreshold) : null}
        oldThreshold={activeThreshold}
        newThreshold={pendingThreshold}
      />
    </>
  );
}

/* ---------------- Threshold confirm modal ---------------- */

function AllocSide({ title, threshold, row }) {
  const allocs = row?.allocations || [];
  const totalQty = allocs.reduce((s, a) => s + (a.allocatedQtyMt || 0), 0);
  return (
    <div className="de-diff-side">
      <div className="de-diff-head">
        <strong>{title}</strong>
        <span className="de-diff-thresh">dE {threshold.toFixed(1)}</span>
      </div>
      <div className="de-diff-summary">
        <span className={`pill ${row?.coverageStatus || 'pending'}`}>{row?.coverageStatus || 'pending'}</span>
        <span>{totalQty.toFixed(2)} MT</span>
      </div>
      {allocs.length === 0 ? (
        <div className="md-callout muted">No lots allocated.</div>
      ) : (
        <div className="md-lot-list">
          {allocs.map((a, idx) => (
            <div className="md-lot" key={`${a.lotNo}-${idx}`}>
              <div className="md-lot-rank">#{a.dynamicConsensusRank ?? a.consensusRank ?? idx + 1}</div>
              <div className="md-lot-mid">
                <div className="md-lot-no">{a.lotNo}</div>
                <div className="md-lot-meta">dE {formatMetric3(a.euclideanDeltaE)} - knn {formatMetric3(a.knnDistance)}</div>
              </div>
              <span className="md-lot-qty">{(a.allocatedQtyMt || 0).toFixed(2)} MT</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ThresholdConfirmModal({ open, onClose, onConfirm, line, oldRow, newRow, oldThreshold, newThreshold }) {
  const oldLots = new Set((oldRow?.allocations || []).map(a => a.lotNo));
  const newLots = new Set((newRow?.allocations || []).map(a => a.lotNo));
  const added = [...newLots].filter(l => !oldLots.has(l));
  const removed = [...oldLots].filter(l => !newLots.has(l));
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Confirm new allocation"
      subtitle={line ? `${line.customerName} - ${line.invoiceNumber}` : ''}
      size="lg"
    >
      <div className="md-callout">
        Switching dE threshold from <strong>{oldThreshold.toFixed(1)}</strong> to <strong>{newThreshold.toFixed(1)}</strong>.
        Default = {DEFAULT_DE_THRESHOLD.toFixed(1)} (the basis for the original allocation).
      </div>
      <div className="de-diff-grid">
        <AllocSide title="Old allocation" threshold={oldThreshold} row={oldRow} />
        <AllocSide title="New allocation" threshold={newThreshold} row={newRow} />
      </div>
      {(added.length > 0 || removed.length > 0) && (
        <div className="de-diff-changes">
          {added.length > 0 && <div><strong>Added:</strong> {added.join(', ')}</div>}
          {removed.length > 0 && <div><strong>Removed:</strong> {removed.join(', ')}</div>}
        </div>
      )}
      <div className="md-actions">
        <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn-primary" onClick={onConfirm}>Use new allocation</button>
      </div>
    </Modal>
  );
}

/* ---------------- Inventory analysis modal contents ---------------- */

function InventoryDetail({ results }) {
  const inventory = results?.inventorySummary || {};
  const inv = results?.inventoryAnalysis || {};
  const lines = results?.eligibleInvoiceLines || [];
  const lots = inventory.lotBreakdown || [];
  const totalDemand = lines.reduce((s, l) => s + (l.qtyMt || 0), 0);
  const supportedDemand = inv.supportedDemandMt || 0;
  const allocatedTotal = inventory.totalAllocatedMt || 0;
  const shortfall = inv.supportedShortfallMt || 0;
  const stockBefore = inventory.totalBeforeMt || 0;
  const stockAfter = inventory.totalAfterMt || 0;
  const drawnPct = stockBefore > 0 ? Math.min(100, (allocatedTotal / stockBefore) * 100) : 0;
  const coveragePct = supportedDemand > 0 ? Math.min(100, (allocatedTotal / supportedDemand) * 100) : 0;

  const outcome = [
    { key: 'good',    count: inv.fullCoverageCount || 0,    label: 'Fully fulfilled' },
    { key: 'warn',    count: inv.partialCoverageCount || 0, label: 'Partial' },
    { key: 'pending', count: inv.pendingCount || 0,         label: 'Pending' },
    { key: 'bad',     count: inv.unfulfilledCount || 0,     label: 'Unfulfilled' },
    { key: 'muted',   count: inv.unsupportedCount || 0,     label: 'Unsupported' },
  ];
  const outcomeTotal = outcome.reduce((s, o) => s + o.count, 0) || 1;

  return (
    <>
      <div className="inv-stat-grid">
        <div className="inv-stat">
          <div className="inv-stat-label">Coverage</div>
          <div className="inv-stat-value">{coveragePct.toFixed(0)}<span className="unit">%</span></div>
          <div className="inv-stat-bar"><div className="inv-stat-bar-fill good" style={{ width: `${coveragePct}%` }} /></div>
          <div className="inv-stat-sub">{allocatedTotal.toFixed(1)} of {supportedDemand.toFixed(1)} MT</div>
        </div>
        <div className="inv-stat">
          <div className="inv-stat-label">Stock drawn</div>
          <div className="inv-stat-value">{drawnPct.toFixed(0)}<span className="unit">%</span></div>
          <div className="inv-stat-bar"><div className="inv-stat-bar-fill warn" style={{ width: `${drawnPct}%` }} /></div>
          <div className="inv-stat-sub">{allocatedTotal.toFixed(1)} of {stockBefore.toFixed(1)} MT</div>
        </div>
        <div className="inv-stat">
          <div className="inv-stat-label">Shortfall</div>
          <div className={`inv-stat-value ${shortfall > 0 ? 'bad' : 'good'}`}>{shortfall.toFixed(1)}<span className="unit">MT</span></div>
          <div className="inv-stat-sub">{shortfall > 0 ? 'demand not covered' : 'fully covered'}</div>
        </div>
        <div className="inv-stat">
          <div className="inv-stat-label">Remaining stock</div>
          <div className="inv-stat-value">{stockAfter.toFixed(1)}<span className="unit">MT</span></div>
          <div className="inv-stat-sub">after simulation</div>
        </div>
      </div>

      <div className="md-section-title">Line outcomes</div>
      <div className="outcome-bar">
        {outcome.filter(o => o.count > 0).map(o => (
          <div
            key={o.key}
            className={`outcome-seg ${o.key}`}
            style={{ flexGrow: o.count, flexBasis: `${(o.count / outcomeTotal) * 100}%` }}
            title={`${o.label}: ${o.count}`}
          >
            <span>{o.count}</span>
          </div>
        ))}
      </div>
      <div className="outcome-legend">
        {outcome.filter(o => o.count > 0).map(o => (
          <span key={o.key} className="outcome-leg">
            <span className={`outcome-leg-dot ${o.key}`} />{o.label} {o.count}
          </span>
        ))}
      </div>

      <div className="md-section-title">
        Lots in stock <span className="md-section-sub">{lots.length} lot{lots.length === 1 ? '' : 's'} - draws live with simulation</span>
      </div>
      {lots.length === 0 ? (
        <div className="md-callout muted">No lots available for this standard.</div>
      ) : (
        <div className="lot-grid">
          {lots.map(lot => {
            const before = lot.qtyBeforeMt || 0;
            const allocLot = lot.qtyAllocatedMt || 0;
            const remaining = lot.qtyRemainingMt || 0;
            const pct = before > 0 ? Math.min(100, (allocLot / before) * 100) : 0;
            const tone = pct >= 95 ? 'bad' : pct >= 1 ? 'warn' : 'good';
            return (
              <div className={`lot-card ${tone}`} key={lot.lotNo}>
                <div className="lot-card-head">
                  <span className="lot-card-no">{lot.lotNo}</span>
                  <span className="lot-card-grade">G{lot.grade}</span>
                </div>
                <div className="lot-card-qty">
                  <strong>{remaining.toFixed(1)}</strong>
                  <span className="unit">/ {before.toFixed(1)} MT</span>
                </div>
                <div className="lot-card-bar">
                  <div className={`lot-card-bar-fill ${tone}`} style={{ width: `${pct}%` }} />
                </div>
                <div className="lot-card-meta">
                  {allocLot > 0 ? `${allocLot.toFixed(1)} MT drawn` : 'untouched'}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="inv-totals">
        <div><span className="inv-totals-label">Total open demand</span><span className="inv-totals-value">{totalDemand.toFixed(1)} MT</span></div>
        <div><span className="inv-totals-label">Supported demand</span><span className="inv-totals-value">{supportedDemand.toFixed(1)} MT</span></div>
        <div><span className="inv-totals-label">Allocated</span><span className="inv-totals-value">{allocatedTotal.toFixed(1)} MT</span></div>
      </div>
    </>
  );
}

/* ---------------- Main ResultsTabs (now a requirement workspace) ---------------- */

function exportFulfillmentReportToExcel(history) {
  if (!history || history.length === 0) return;
  const fmtDate = (iso) => {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  };

  const invoiceRows = [];
  const inventoryRows = [];
  history.forEach((r, idx) => {
    const fNum = history.length - idx;
    const lockedAt = fmtDate(r.timestamp);
    r.lines.forEach(line => {
      const lotsDrawn = line.allocations
        .map(a => `${a.lotNo} - ${(a.allocatedQtyMt || 0).toFixed(2)} MT`)
        .join('; ');
      invoiceRows.push({
        'Fulfillment #': fNum,
        'Locked in': lockedAt,
        'Standard': r.standardCode,
        'User': r.user || 'unknown',
        'Requirement': line.invoiceNumber,
        'Customer': line.customerName,
        'Application': line.application || '-',
        'Requested (MT)': Number((line.qtyRequestedMt || 0).toFixed(2)),
        'Allocated (MT)': Number((line.qtyAllocatedMt || 0).toFixed(2)),
        'Shortfall (MT)': Number((line.shortfallMt || 0).toFixed(2)),
        'Lots drawn': lotsDrawn,
      });
    });
    (r.remainingLots || []).forEach(lot => {
      const drawn = (lot.qtyBeforeMt || 0) - (lot.qtyRemainingMt || 0);
      inventoryRows.push({
        'Fulfillment #': fNum,
        'Standard': r.standardCode,
        'Lot': lot.lotNo,
        'Grade': `G${lot.grade}`,
        'Touched': lot.touched ? 'yes' : 'no',
        'Drawn (MT)': Number(drawn.toFixed(2)),
        'Remaining (MT)': Number((lot.qtyRemainingMt || 0).toFixed(2)),
        'Original (MT)': Number((lot.qtyBeforeMt || 0).toFixed(2)),
      });
    });
  });

  const wb = XLSX.utils.book_new();
  const invSheet = XLSX.utils.json_to_sheet(invoiceRows);
  XLSX.utils.book_append_sheet(wb, invSheet, 'Requirements fulfilled');
  if (inventoryRows.length) {
    const lotSheet = XLSX.utils.json_to_sheet(inventoryRows);
    XLSX.utils.book_append_sheet(wb, lotSheet, 'Remaining inventory');
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
  XLSX.writeFile(wb, `fulfillment-report-${stamp}.xlsx`);
}

function FulfillmentReport({ history }) {
  if (!history || history.length === 0) {
    return <div className="md-callout muted">No fulfillment locked in yet. Apply decisions and hit "Lock in allocation" to generate a report.</div>;
  }
  const fmtDate = (iso) => {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  };
  return (
    <div className="fr-root">
      {history.map((r, idx) => (
        <section className="fr-section" key={r.id}>
          <div className="fr-section-head">
            <div>
              <div className="fr-section-title">Fulfillment #{history.length - idx}</div>
              <div className="fr-section-sub">
                Standard {r.standardCode} - {r.linesAffected} line{r.linesAffected === 1 ? '' : 's'} - {r.lotMovements} lot movement{r.lotMovements === 1 ? '' : 's'} - by {r.user || 'unknown'}
              </div>
            </div>
            <div className="fr-date-callout">
              <div className="fr-date-label">Locked in</div>
              <div className="fr-date-value">{fmtDate(r.timestamp)}</div>
            </div>
          </div>

          <div className="fr-subtitle">Requirements fulfilled</div>
          <table className="fr-table">
            <thead>
              <tr>
                <th>Requirement</th>
                <th>Customer</th>
                <th>Application</th>
                <th className="num">Requested</th>
                <th className="num">Allocated</th>
                <th className="num">Shortfall</th>
                <th>Lots drawn</th>
              </tr>
            </thead>
            <tbody>
              {r.lines.map(line => (
                <tr key={line.invoiceLineId}>
                  <td className="mono">{line.invoiceNumber}</td>
                  <td>{line.customerName}</td>
                  <td>{line.application || '-'}</td>
                  <td className="num">{(line.qtyRequestedMt || 0).toFixed(2)} MT</td>
                  <td className="num">{(line.qtyAllocatedMt || 0).toFixed(2)} MT</td>
                  <td className="num">{(line.shortfallMt || 0).toFixed(2)} MT</td>
                  <td>
                    {line.allocations.map((a, i) => (
                      <div className="fr-lot-line" key={i}>
                        <span className="mono">{a.lotNo}</span> - {(a.allocatedQtyMt || 0).toFixed(2)} MT
                      </div>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="fr-subtitle">Remaining inventory on {r.standardCode}</div>
          {r.remainingLots.length === 0 ? (
            <div className="md-callout muted">No lot data captured.</div>
          ) : (
            <table className="fr-table">
              <thead>
                <tr>
                  <th>Lot</th>
                  <th>Grade</th>
                  <th className="num">Remaining</th>
                  <th className="num">Original</th>
                </tr>
              </thead>
              <tbody>
                {r.remainingLots.map(lot => {
                  const drawn = (lot.qtyBeforeMt || 0) - (lot.qtyRemainingMt || 0);
                  return (
                    <tr key={lot.lotNo} className={lot.touched ? 'fr-row-touched' : ''}>
                      <td className="mono">
                        {lot.touched && <span className="fr-touched-dot" />}
                        {lot.lotNo}
                        {lot.touched && <span className="fr-touched-tag">drawn -{drawn.toFixed(2)} MT</span>}
                      </td>
                      <td>G{lot.grade}</td>
                      <td className="num">{(lot.qtyRemainingMt || 0).toFixed(2)} MT</td>
                      <td className="num">{(lot.qtyBeforeMt || 0).toFixed(2)} MT</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      ))}
    </div>
  );
}

function ResultsTabs({
  results,
  baselineResults,
  decisions,
  dEOverrides = {},
  onApplyRecommended,
  onSkip,
  onUndo,
  onResetDecisions,
  onSetDeThreshold,
  onClearDeThreshold,
  previewWithThreshold,
  fulfillmentHistory = [],
  reportOpen = false,
  onOpenReport,
  onCloseReport,
  isAdmin = false,
  onOpenMatchingFlow,
}) {
  const [openLineId, setOpenLineId] = useState(null);
  const [showInventory, setShowInventory] = useState(false);
  const [filter, setFilter] = useState('all');

  const candidatesByLine = results?.lotCandidatesByInvoiceLine || {};
  const allocByLine = useMemo(
    () => Object.fromEntries((results?.allocation || []).map(r => [r.invoiceLineId, r])),
    [results]
  );
  const baselineAllocByLine = useMemo(
    () => Object.fromEntries(((baselineResults || results)?.allocation || []).map(r => [r.invoiceLineId, r])),
    [baselineResults, results]
  );

  const sorted = useMemo(() => (results?.eligibleInvoiceLines || []).slice().sort((a, b) => {
    const ap = a.isPartiallyFulfilled ? 0 : 1;
    const bp = b.isPartiallyFulfilled ? 0 : 1;
    if (ap !== bp) return ap - bp;
    const ar = a.fulfillabilityRank ?? 9999;
    const br = b.fulfillabilityRank ?? 9999;
    if (ar !== br) return ar - br;
    return (a.invoiceLineId || '').localeCompare(b.invoiceLineId || '');
  }), [results]);

  const invoiceHues = useMemo(() => assignInvoiceHues(sorted), [sorted]);

  const decisionCount = Object.keys(decisions || {}).length;
  const appliedCount = Object.values(decisions || {}).filter(d => d === 'full' || d === 'partial').length;
  const skippedCount = Object.values(decisions || {}).filter(d => d === 'none').length;
  const pendingCount = sorted.filter(l => l.isSupported && !decisions?.[l.invoiceLineId]).length;

  const filtered = sorted.filter(l => {
    if (filter === 'all') return true;
    const d = decisions?.[l.invoiceLineId];
    if (filter === 'pending') return l.isSupported && !d;
    if (filter === 'applied') return d === 'full' || d === 'partial';
    if (filter === 'skipped') return d === 'none';
    if (filter === 'blocked') return !l.isSupported || (allocByLine[l.invoiceLineId]?.coverageStatus === 'unfulfilled' && !d);
    return true;
  });

  const openLine = openLineId ? sorted.find(l => l.invoiceLineId === openLineId) : null;
  const openAlloc = openLine ? allocByLine[openLine.invoiceLineId] : null;
  const openDecision = openLine ? decisions?.[openLine.invoiceLineId] : null;

  return (
    <div className="tabs-panel">
      <div className="iw-head">
        <div>
          <h4 className="iw-title">Open requirements</h4>
          <div className="iw-sub">
            {sorted.length} line{sorted.length === 1 ? '' : 's'} - decisions consume shared stock as you apply them
          </div>
        </div>
        <div className="iw-head-actions">
          {isAdmin && (
            <button className="btn btn-sm btn-ghost" type="button" onClick={onOpenMatchingFlow}>Flow audit</button>
          )}
          <button className="btn btn-sm btn-ghost" type="button" onClick={() => setShowInventory(true)}>Inventory analysis</button>
          <button
            className="btn btn-sm btn-ghost"
            type="button"
            onClick={onOpenReport}
            disabled={!fulfillmentHistory.length}
            title={fulfillmentHistory.length ? `${fulfillmentHistory.length} report(s) available` : 'No fulfillments locked in yet'}
          >
            View fulfillment report{fulfillmentHistory.length > 0 ? ` (${fulfillmentHistory.length})` : ''}
          </button>
          {decisionCount > 0 && (
            <button className="btn btn-sm btn-ghost" type="button" onClick={onResetDecisions}>Reset {decisionCount}</button>
          )}
        </div>
      </div>

      <div className="iw-filters">
        {[
          { id: 'all',     label: `All ${sorted.length}` },
          { id: 'pending', label: `Pending ${pendingCount}` },
          { id: 'applied', label: `Applied ${appliedCount}` },
          { id: 'skipped', label: `Skipped ${skippedCount}` },
          { id: 'blocked', label: 'Blocked' },
        ].map(f => (
          <button key={f.id} className={`iw-filter ${filter === f.id ? 'active' : ''}`} onClick={() => setFilter(f.id)} type="button">
            {f.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="empty-state">No requirements in this view.</div>
      ) : (
        <div className="inv-card-grid">
          {clusterGroups(filtered).map(grp => {
            const hue = invoiceHues[grp.invoiceNumber];
            const renderCard = (line) => (
              <InvoiceRow
                key={line.invoiceLineId}
                line={line}
                allocRow={allocByLine[line.invoiceLineId]}
                decision={decisions?.[line.invoiceLineId]}
                invoiceHue={hue}
                onApply={onApplyRecommended}
                onSkip={onSkip}
                onUndo={onUndo}
                onOpen={() => setOpenLineId(line.invoiceLineId)}
              />
            );
            if (grp.lines.length === 1) return renderCard(grp.lines[0]);
            return (
              <div
                key={grp.invoiceNumber}
                className="inv-cluster"
                style={{
                  ...(Number.isFinite(hue) ? { '--inv-hue': hue } : {}),
                  gridColumn: `span ${grp.lines.length}`,
                }}
              >
                {grp.lines.map(renderCard)}
              </div>
            );
          })}
        </div>
      )}

      <Modal
        open={!!openLine}
        onClose={() => setOpenLineId(null)}
        title={openLine?.customerName || ''}
        subtitle={openLine ? `${openLine.invoiceNumber} - ${openLine.application || 'no app'} - match ${openLine.resolvedMethodId} - required ${openLine.targetMethodId ? openLine.targetMethodId.split(/[,;|]+/).map(s => s.trim()).filter(Boolean).join(', ') : 'none'}` : ''}
        size="lg"
      >
        {openLine && (
          <InvoiceDetail
            line={openLine}
            allocRow={openAlloc}
            baselineAllocRow={baselineAllocByLine[openLine.invoiceLineId]}
            candidates={candidatesByLine[openLine.invoiceLineId] || []}
            decision={openDecision}
            dEOverride={dEOverrides?.[openLine.invoiceLineId]}
            onApply={onApplyRecommended}
            onSkip={onSkip}
            onUndo={onUndo}
            onClose={() => setOpenLineId(null)}
            onSetDeThreshold={onSetDeThreshold}
            onClearDeThreshold={onClearDeThreshold}
            previewWithThreshold={previewWithThreshold}
          />
        )}
      </Modal>

      <Modal
        open={reportOpen}
        onClose={onCloseReport}
        title="Fulfillment report"
        subtitle={fulfillmentHistory.length ? `${fulfillmentHistory.length} lock-in${fulfillmentHistory.length === 1 ? '' : 's'} recorded this session` : 'No history yet'}
        size="lg"
        bodyClassName="fr-body"
        headerExtra={
          fulfillmentHistory.length > 0 ? (
            <>
              <button className="btn btn-sm btn-ghost no-print" type="button" onClick={() => exportFulfillmentReportToExcel(fulfillmentHistory)}>Export to Excel</button>
              <button className="btn btn-sm btn-ghost no-print" type="button" onClick={() => window.print()}>Print</button>
            </>
          ) : null
        }
      >
        <FulfillmentReport history={fulfillmentHistory} />
      </Modal>

      <Modal
        open={showInventory}
        onClose={() => setShowInventory(false)}
        title="Inventory analysis"
        subtitle="How the simulation reshapes stock and demand"
        size="md"
      >
        <InventoryDetail results={results} />
      </Modal>
    </div>
  );
}

export default ResultsTabs;
