import React, { useState } from 'react';

const Chevron = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

const coverageStatus = (coveragePct) => {
  if (coveragePct >= 95) return { key: 'good', label: 'Full coverage' };
  if (coveragePct >= 40) return { key: 'warn', label: 'Partial coverage' };
  if (coveragePct >= 5)  return { key: 'warn', label: 'Limited coverage' };
  return { key: 'bad', label: 'Critical coverage' };
};

const dotForCoverage = (status) => {
  if (status === 'full') return 'good';
  if (status === 'partial') return 'warn';
  if (status === 'unsupported') return 'muted';
  return 'bad';
};

const PERCEPT_ORDER = { imperceptible: 0, slight: 1, noticeable: 2, distinct: 3, obvious: 4, unknown: 5 };

function ProductionPanel({ analysis, selectedStandard, mode, onCommit, committing, hasDecisions }) {
  const [open, setOpen] = useState({ inventory: true, coverage: false, reasons: false });
  if (!analysis) return null;

  const inventory = analysis.inventorySummary || {};
  const inv = analysis.inventoryAnalysis || {};
  const allocations = analysis.allocation || [];
  const lotBreakdown = inventory.lotBreakdown || [];

  const stockBefore = inventory.totalBeforeMt || 0;
  const allocated = inventory.totalAllocatedMt || 0;
  const demand = inv.supportedDemandMt || 0;
  const shortfall = inv.supportedShortfallMt || 0;
  const coveragePct = demand > 0 ? Math.min(100, (allocated / demand) * 100) : 100;

  const status = demand === 0
    ? { key: 'muted', label: 'No open demand' }
    : coverageStatus(coveragePct);

  const fullCount = allocations.filter(a => a.coverageStatus === 'full').length;
  const partialCount = allocations.filter(a => a.coverageStatus === 'partial').length;
  const unfulfilledCount = allocations.filter(a => a.coverageStatus === 'unfulfilled').length;
  const unsupportedCount = allocations.filter(a => a.coverageStatus === 'unsupported').length;

  const outOfTol = allocations.filter(a => a.supportStatus === 'unsupported_out_of_tolerance').length;
  const noMethod = allocations.filter(a => a.supportStatus === 'unsupported_no_method_results').length;

  // Top recommended lots: best perceptual hit per lot across all eligible candidates.
  const candByLine = analysis.lotCandidatesByInvoiceLine || {};
  const bestByLot = {};
  Object.values(candByLine).forEach(arr => {
    (arr || []).forEach(c => {
      if (!c.isEligibleForTolerance) return;
      const k = (c.perceptual?.key) || 'unknown';
      const rank = PERCEPT_ORDER[k] ?? 5;
      const prev = bestByLot[c.lotNo];
      if (!prev || rank < prev.rank || (rank === prev.rank && (c.consensusRank ?? 9999) < (prev.consensusRank ?? 9999))) {
        bestByLot[c.lotNo] = {
          lotNo: c.lotNo,
          rank,
          perceptual: c.perceptual,
          consensusRank: c.consensusRank,
          dE: c.euclideanDeltaE,
          methodId: c.matchMethodId || c.methodId,
          availableTests: c.availableTests || [],
          isSuperLot: c.isSuperLot,
        };
      }
    });
  });
  const topPicks = Object.values(bestByLot)
    .filter(p => p.rank <= 1) // imperceptible or slight only
    .sort((a, b) => (a.rank - b.rank) || ((a.consensusRank ?? 9999) - (b.consensusRank ?? 9999)))
    .slice(0, 5);

  const toggle = (k) => setOpen(s => ({ ...s, [k]: !s[k] }));

  const canCommit = mode === 'commit' && hasDecisions && !committing;

  return (
    <div className="production-panel">
      <div className="pp-header">
        <div className="pp-eyebrow">Standard inventory</div>
        <div className="pp-std">{selectedStandard?.standardCode}</div>
        <div className="pp-grade">Grade {selectedStandard?.grade} - {lotBreakdown.length} lot{lotBreakdown.length === 1 ? '' : 's'}</div>
      </div>

      <div className={`pp-status ${status.key}`}>
        <div className="pp-status-dot" />
        <div>
          <div className="pp-status-label">{status.label}</div>
          <div className="pp-status-sub">
            {stockBefore.toFixed(1)} MT stock - {demand.toFixed(1)} MT demand - {shortfall.toFixed(1)} MT short
          </div>
        </div>
      </div>

      <div className="pp-coverage">
        <div className="pp-cov-row">
          <span>Allocated <strong>{allocated.toFixed(1)} MT</strong></span>
          <span>Demand <strong>{demand.toFixed(1)} MT</strong></span>
        </div>
        <div className="pp-bar">
          <div className={`pp-bar-fill ${status.key}`} style={{ width: `${coveragePct}%` }} />
        </div>
        <div className="pp-cov-pct">{coveragePct.toFixed(0)}% of open demand covered</div>
      </div>

      <div className="pp-top-picks">
        <div className="pp-top-picks-title">
          <span>Top color matches</span>
          <span style={{ color: 'var(--ink-4)', fontWeight: 500, textTransform: 'none', letterSpacing: 0 }}>
            imperceptible / slight only
          </span>
        </div>
        {topPicks.length === 0 ? (
          <div className="pp-top-empty">
            No lot in stock falls within imperceptible or slight color range for the open requirements on this standard. Review candidates before locking anything in.
          </div>
        ) : (
          topPicks.map((p, i) => (
            <div className="pp-top-pick" key={p.lotNo}>
              <div className="pp-top-pick-rank">{i + 1}</div>
              <div className="pp-top-pick-mid">
                <div className="pp-top-pick-lot">{p.lotNo}</div>
                <div className="pp-top-pick-meta">
                  dE {p.dE ?? '-'} - consensus #{p.consensusRank ?? '-'} - {p.methodId}
                  {p.availableTests?.length ? ` - tests ${p.availableTests.join(', ')}` : ''}
                  {p.isSuperLot ? ' - super lot' : ''}
                </div>
              </div>
              <span className={`pp-top-pick-badge ${p.perceptual?.key || 'unknown'}`}>
                {p.perceptual?.label || 'unknown'}
              </span>
            </div>
          ))
        )}
      </div>

      <div className="pp-section">
        <button className={`pp-section-head ${open.inventory ? 'open' : ''}`} onClick={() => toggle('inventory')} type="button">
          <span>Lots in stock</span>
          <span className="pp-section-badges">
            <span className="pp-badge muted">{lotBreakdown.length}</span>
          </span>
          <Chevron />
        </button>
        <div className={`pp-section-body ${open.inventory ? 'open' : ''}`}>
          {lotBreakdown.length === 0 && <div className="empty-state">No lots</div>}
          {lotBreakdown.map(lot => {
            const before = lot.qtyBeforeMt || 0;
            const allocLot = lot.qtyAllocatedMt || 0;
            const pct = before > 0 ? Math.min(100, (allocLot / before) * 100) : 0;
            return (
              <div className="pp-lot" key={lot.lotNo}>
                <div className="pp-lot-head">
                  <span>
                    <span className="pp-lot-no">{lot.lotNo}</span>
                    <span className="pp-lot-grade">Grade {lot.grade}</span>
                  </span>
                  <span className="pp-lot-qty">{lot.qtyRemainingMt?.toFixed(2)} / {before.toFixed(2)} MT</span>
                </div>
                <div className="pp-lot-bar">
                  <div className="pp-lot-bar-fill" style={{ width: `${pct}%` }} />
                </div>
                <div className="pp-lot-meta">
                  <span>allocated {allocLot.toFixed(2)} MT</span>
                  <span>{pct.toFixed(0)}% drawn</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="pp-section">
        <button className={`pp-section-head ${open.coverage ? 'open' : ''}`} onClick={() => toggle('coverage')} type="button">
          <span>Requirement coverage</span>
          <span className="pp-section-badges">
            {fullCount > 0 && <span className="pp-badge good">{fullCount}</span>}
            {partialCount > 0 && <span className="pp-badge warn">{partialCount}</span>}
            {(unfulfilledCount + unsupportedCount) > 0 && <span className="pp-badge bad">{unfulfilledCount + unsupportedCount}</span>}
          </span>
          <Chevron />
        </button>
        <div className={`pp-section-body ${open.coverage ? 'open' : ''}`}>
          <div className="pp-coverage-list">
            {allocations.length === 0 && <div className="empty-state">No requirement lines</div>}
            {allocations.map(a => (
              <div className="pp-cov-line" key={a.invoiceLineId}>
                <span className={`pp-cov-dot ${dotForCoverage(a.coverageStatus)}`} />
                <span className="pp-cov-line-id">{a.invoiceNumber}</span>
                <span className="pp-cov-line-qty">{(a.qtyAllocatedMt || 0).toFixed(1)} / {(a.qtyRequestedMt || 0).toFixed(1)}t</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {(outOfTol > 0 || noMethod > 0) && (
        <div className="pp-section">
          <button className={`pp-section-head ${open.reasons ? 'open' : ''}`} onClick={() => toggle('reasons')} type="button">
            <span>Why some lines were skipped</span>
            <span className="pp-section-badges">
              <span className="pp-badge muted">{outOfTol + noMethod}</span>
            </span>
            <Chevron />
          </button>
          <div className={`pp-section-body ${open.reasons ? 'open' : ''}`}>
            <div className="pp-reasons">
              {outOfTol > 0 && <div>{outOfTol} line{outOfTol === 1 ? '' : 's'} have lot candidates but none fall inside the strict color tolerance.</div>}
              {noMethod > 0 && <div style={{ marginTop: 4 }}>{noMethod} line{noMethod === 1 ? '' : 's'} have no matching method results in the lot test database.</div>}
            </div>
          </div>
        </div>
      )}

      <div className="pp-actions">
        {mode === 'commit' ? (
          <>
            <button className="btn btn-primary" disabled={!canCommit} onClick={onCommit} type="button">
              {committing ? 'Committing...' : 'Lock in allocation'}
            </button>
            <div className="pp-action-hint">
              Locking will decrement lot quantities, update outstanding requirement quantities, and write an audit row.
            </div>
          </>
        ) : (
          <div className="pp-action-hint">
            <strong style={{ color: 'var(--ink-2)' }}>Simulation mode.</strong> Apply decisions on requirement cards to see how stock moves. Switch to Commit mode in the sidebar when ready to lock in.
          </div>
        )}
      </div>
    </div>
  );
}

export default ProductionPanel;
