import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import config from './config';
import PigmentSelector from './components/PigmentSelector';
import ResultsTabs from './components/ResultsTabs';
import UpdateDataTab from './components/UpdateDataTab';
import MatchingFlowTab from './components/MatchingFlowTab';
import { DEFAULT_DE_THRESHOLD, recomputeConsensus, filterCandidatesByThreshold } from './utils/allocation';

const ThinkingScreen = () => (
  <div className="thinking-overlay">
    <div className="thinking-box">
      <h2 className="thinking-title">Analyzing</h2>
      <p className="thinking-text">Evaluating open requirements against current stock.</p>
      <div className="thinking-dots"><span /><span /><span /></div>
    </div>
  </div>
);

const sortCandidatesForAllocation = (candidates = [], threshold = DEFAULT_DE_THRESHOLD) => {
  const eligible = filterCandidatesByThreshold(candidates, threshold);
  return recomputeConsensus(eligible);
};

const recommendedAction = (line, possibleQty) => {
  if (!line?.isSupported) return 'none';
  const qty = Number(line.qtyMt || 0);
  if (qty <= 0) return 'full';
  if (possibleQty >= qty - 1e-9) return 'full';
  if (possibleQty > 0) return 'partial';
  return 'none';
};

const buildDynamicAllocation = (base, decisions, dEOverrides = {}) => {
  if (!base) return null;
  const lotBaseline = base?.inventorySummary?.lotBreakdown || [];
  const remainingByLot = {};
  const beforeByLot = {};
  const dynamicCandidatesByLine = {};
  lotBaseline.forEach(lot => {
    const before = Number(lot.qtyBeforeMt || 0);
    beforeByLot[lot.lotNo] = before;
    remainingByLot[lot.lotNo] = before;
  });

  const eligibleLines = (base.eligibleInvoiceLines || []).slice().sort((a, b) => {
    const ap = a.isPartiallyFulfilled ? 0 : 1;
    const bp = b.isPartiallyFulfilled ? 0 : 1;
    if (ap !== bp) return ap - bp;
    const ar = a.fulfillabilityRank ?? 9999;
    const br = b.fulfillabilityRank ?? 9999;
    if (ar !== br) return ar - br;
    return (a.invoiceLineId || '').localeCompare(b.invoiceLineId || '');
  });

  const allocation = [];
  const candByLine = base.lotCandidatesByInvoiceLine || {};

  eligibleLines.forEach(line => {
    const lineId = line.invoiceLineId;
    const decision = decisions?.[lineId] || null;
    const qtyRequested = Number(line.qtyMt || 0);
    const overrideThreshold = dEOverrides?.[lineId];
    const threshold = Number.isFinite(overrideThreshold) ? overrideThreshold : DEFAULT_DE_THRESHOLD;
    const isOverridden = Number.isFinite(overrideThreshold) && Math.abs(overrideThreshold - DEFAULT_DE_THRESHOLD) > 1e-9;
    const rawLineCandidates = candByLine[lineId] || [];
    dynamicCandidatesByLine[lineId] = rawLineCandidates.map(c => ({
      ...c,
      simulatedAvailableQtyMt: Number((remainingByLot[c.lotNo] || 0).toFixed(3)),
      sourceAvailableQtyMt: Number((c.availableQtyMt || 0).toFixed(3)),
    }));
    const lineCands = sortCandidatesForAllocation(dynamicCandidatesByLine[lineId], threshold);
    // attach dynamic ranks back onto the dynamicCandidatesByLine entries so the modal can render them
    const dynamicByLot = new Map(lineCands.map(c => [c.lotNo, c]));
    dynamicCandidatesByLine[lineId] = dynamicCandidatesByLine[lineId].map(c => {
      const dyn = dynamicByLot.get(c.lotNo);
      if (!dyn) return c;
      return {
        ...c,
        dynamicConsensusRank: dyn.dynamicConsensusRank,
        dynamicConsensusScore: dyn.dynamicConsensusScore,
        dynamicEuclideanRank: dyn.dynamicEuclideanRank,
        dynamicCosineRank: dyn.dynamicCosineRank,
        dynamicKnnRank: dyn.dynamicKnnRank,
        passesDeThreshold: true,
      };
    });
    const possibleQty = lineCands.reduce((sum, c) => sum + Number(remainingByLot[c.lotNo] || 0), 0);
    const rec = recommendedAction(line, possibleQty);

    const row = {
      invoiceLineId: line.invoiceLineId,
      invoiceId: line.invoiceId,
      invoiceNumber: line.invoiceNumber,
      customerName: line.customerName,
      application: line.application,
      resolvedMethodId: line.resolvedMethodId,
      qtyRequestedMt: qtyRequested,
      qtyAllocatedMt: 0,
      shortfallMt: qtyRequested,
      coverageStatus: line.isSupported ? 'pending' : 'unsupported',
      allocations: [],
      isSupported: line.isSupported,
      supportStatus: line.supportStatus,
      supportReason: line.supportReason,
      fulfillabilityRank: line.fulfillabilityRank,
      userDecision: decision,
      recommendedAction: rec,
      availableCandidateQtyMt: Number(possibleQty.toFixed(3)),
      dEThreshold: threshold,
      dEThresholdIsDefault: !isOverridden,
    };

    if (!line.isSupported) { allocation.push(row); return; }

    if (qtyRequested <= 0) {
      row.coverageStatus = 'full';
      row.shortfallMt = 0;
      row.userDecision = decision || 'full';
      allocation.push(row);
      return;
    }

    if (!decision) {
      row.coverageStatus = rec === 'none' ? 'unfulfilled' : 'pending';
      row.shortfallMt = Number(qtyRequested.toFixed(3));
      allocation.push(row);
      return;
    }

    let toApply = decision;
    if (toApply === 'full' && possibleQty + 1e-9 < qtyRequested) {
      toApply = possibleQty > 0 ? 'partial' : 'none';
    }

    if (toApply === 'none') {
      row.coverageStatus = 'unfulfilled';
      row.userDecision = 'none';
      allocation.push(row);
      return;
    }

    let need = qtyRequested;
    lineCands.forEach(c => {
      if (need <= 0) return;
      const available = Number(remainingByLot[c.lotNo] || 0);
      if (available <= 0) return;
      const take = Math.min(need, available);
      remainingByLot[c.lotNo] = Number((available - take).toFixed(6));
      need -= take;
      row.allocations.push({
        lotId: c.lotId,
        lotNo: c.lotNo,
        allocatedQtyMt: Number(take.toFixed(3)),
        fitDeToTarget: c.fitDeToTarget,
        fitBand: c.fitBand,
        methodId: c.methodId,
        matchMethodId: c.matchMethodId || c.methodId,
        matchedTestMethodId: c.matchedTestMethodId || c.methodId,
        availableTests: c.availableTests || [],
        availableTestCount: c.availableTestCount || 0,
        isSuperLot: Boolean(c.isSuperLot),
        superLotPolicy: c.superLotPolicy,
        euclideanDeltaE: c.euclideanDeltaE,
        cosineSimilarity: c.cosineSimilarity,
        knnDistance: c.knnDistance,
        consensusRank: c.consensusRank,
        consensusScore: c.consensusScore,
        dynamicConsensusRank: c.dynamicConsensusRank,
        dynamicConsensusScore: c.dynamicConsensusScore,
        perceptual: c.perceptual,
      });
    });

    const allocated = Number((qtyRequested - need).toFixed(3));
    row.userDecision = toApply;
    row.qtyAllocatedMt = allocated;
    row.shortfallMt = Number(Math.max(0, qtyRequested - allocated).toFixed(3));
    if (allocated >= qtyRequested - 1e-9) row.coverageStatus = 'full';
    else if (allocated > 0) row.coverageStatus = 'partial';
    else row.coverageStatus = 'unfulfilled';
    allocation.push(row);
  });

  const lotBreakdown = lotBaseline.map(lot => {
    const before = Number(beforeByLot[lot.lotNo] || 0);
    const remaining = Number((remainingByLot[lot.lotNo] ?? before).toFixed(3));
    const allocated = Number((before - remaining).toFixed(3));
    return { ...lot, qtyBeforeMt: Number(before.toFixed(3)), qtyAllocatedMt: allocated, qtyRemainingMt: remaining };
  });

  const totalBefore = Number(lotBreakdown.reduce((s, l) => s + l.qtyBeforeMt, 0).toFixed(3));
  const totalAfter = Number(lotBreakdown.reduce((s, l) => s + l.qtyRemainingMt, 0).toFixed(3));
  const totalAllocated = Number((totalBefore - totalAfter).toFixed(3));

  const supported = allocation.filter(a => a.isSupported);
  const supportedDemandMt = Number(supported.reduce((s, a) => s + (a.qtyRequestedMt || 0), 0).toFixed(3));
  const supportedShortfallMt = Number(supported.reduce((s, a) => s + (a.shortfallMt || 0), 0).toFixed(3));

  return {
    ...base,
    allocation,
    lotCandidatesByInvoiceLine: dynamicCandidatesByLine,
    inventorySummary: { ...(base.inventorySummary || {}), totalBeforeMt: totalBefore, totalAllocatedMt: totalAllocated, totalAfterMt: totalAfter, lotBreakdown },
    inventoryAnalysis: {
      ...(base.inventoryAnalysis || {}),
      fullCoverageCount: allocation.filter(a => a.coverageStatus === 'full').length,
      partialCoverageCount: allocation.filter(a => a.coverageStatus === 'partial').length,
      pendingCount: allocation.filter(a => a.coverageStatus === 'pending').length,
      unfulfilledCount: allocation.filter(a => a.coverageStatus === 'unfulfilled').length,
      unsupportedCount: allocation.filter(a => a.coverageStatus === 'unsupported').length,
      supportedDemandMt,
      supportedShortfallMt,
      leftoverInventoryMt: totalAfter,
      lineCount: allocation.length,
    },
  };
};

function Toast({ msg, kind }) {
  if (!msg) return null;
  return <div className={`toast ${kind || ''}`}>{msg}</div>;
}

function GlanceLotCard({ lot, feeds, tone, pct, before, remaining }) {
  return (
    <div className={`glance-lot ${tone}`}>
      <div className="glance-lot-head">
        <span className="glance-lot-no">{lot.lotNo}</span>
        <span className="glance-lot-grade">G{lot.grade}</span>
      </div>
      <div className="glance-lot-qty">
        <strong>{remaining.toFixed(1)}</strong>
        <span className="unit">/ {before.toFixed(1)} MT</span>
      </div>
      <div className="glance-lot-bar">
        <div className={`glance-lot-bar-fill ${tone}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="glance-lot-feeds">
        {feeds.length === 0 ? (
          <span className="glance-lot-feeds-empty">untouched</span>
        ) : (
          feeds.map((f, i) => (
            <div className="glance-feed" key={`${f.invoiceNumber}-${i}`}>
              <span className="glance-feed-cust" title={`${f.customer} - ${f.invoiceNumber}`}>
                {f.customer} - {f.invoiceNumber}
              </span>
              <span className="glance-feed-qty">{f.qty.toFixed(2)} MT</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function InventoryGlance({ display }) {
  const [expanded, setExpanded] = useState(false);
  const inv = display?.inventorySummary || {};
  const allocations = display?.allocation || [];

  const feedsByLot = {};
  allocations.forEach(row => {
    (row.allocations || []).forEach(a => {
      if (!feedsByLot[a.lotNo]) feedsByLot[a.lotNo] = [];
      feedsByLot[a.lotNo].push({
        customer: row.customerName,
        invoiceNumber: row.invoiceNumber,
        qty: a.allocatedQtyMt || 0,
      });
    });
  });

  const sortedLots = useMemo(() => (
    (inv.lotBreakdown || []).slice().sort((a, b) => {
      const aAllocated = Number(a.qtyAllocatedMt || 0);
      const bAllocated = Number(b.qtyAllocatedMt || 0);
      const aTouched = aAllocated > 0 ? 1 : 0;
      const bTouched = bAllocated > 0 ? 1 : 0;
      if (aTouched !== bTouched) return bTouched - aTouched;
      if (aAllocated !== bAllocated) return bAllocated - aAllocated;
      const aRemaining = Number(a.qtyRemainingMt || 0);
      const bRemaining = Number(b.qtyRemainingMt || 0);
      if (aRemaining !== bRemaining) return aRemaining - bRemaining;
      return (a.lotNo || '').localeCompare(b.lotNo || '');
    })
  ), [inv.lotBreakdown]);

  if (sortedLots.length === 0) {
    return (
      <div className="inv-glance">
        <div className="inv-glance-head">
          <span className="inv-glance-title">Inventory at a glance</span>
        </div>
        <div className="inv-glance-empty">No lots available for this standard.</div>
      </div>
    );
  }

  const cardFor = (lot) => {
    const before = lot.qtyBeforeMt || 0;
    const allocLot = lot.qtyAllocatedMt || 0;
    const remaining = lot.qtyRemainingMt || 0;
    const pct = before > 0 ? Math.min(100, (allocLot / before) * 100) : 0;
    const tone = pct >= 95 ? 'bad' : pct >= 1 ? 'warn' : 'good';
    return (
      <GlanceLotCard
        key={lot.lotNo}
        lot={lot}
        feeds={feedsByLot[lot.lotNo] || []}
        tone={tone}
        pct={pct}
        before={before}
        remaining={remaining}
      />
    );
  };

  return (
    <>
      <div className="inv-glance">
        <div className="inv-glance-head">
          <span className="inv-glance-title">Inventory at a glance</span>
          <button type="button" className="inv-glance-expand" onClick={() => setExpanded(true)}>
            View all {sortedLots.length} lot{sortedLots.length === 1 ? '' : 's'}
          </button>
        </div>
        <div className="inv-glance-strip" onClick={() => setExpanded(true)} role="button">
          {sortedLots.map(cardFor)}
        </div>
      </div>

      {expanded && createPortal(
        <div className="modal-backdrop" onClick={() => setExpanded(false)}>
          <div className="modal modal-lg inv-glance-modal" onClick={(e) => e.stopPropagation()} role="dialog">
            <div className="modal-head">
              <div>
                <div className="modal-title">Inventory at a glance</div>
                <div className="modal-subtitle">{sortedLots.length} lot{sortedLots.length === 1 ? '' : 's'} - draws update live as you simulate</div>
              </div>
              <button className="modal-close" type="button" onClick={() => setExpanded(false)} aria-label="Close">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" />
                </svg>
              </button>
            </div>
            <div className="modal-body">
              <div className="inv-glance-grid">
                {sortedLots.map(cardFor)}
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

const BellIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
  </svg>
);

function Dashboard({ user, onLogout }) {
  const [standards, setStandards] = useState([]);
  const [requirementSummary, setRequirementSummary] = useState({ requirementLineCount: 0, unsupportedLineCount: 0 });
  const [results, setResults] = useState(null);
  const [decisions, setDecisions] = useState({});
  const [dEOverrides, setDEOverrides] = useState({});
  const [thinking, setThinking] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [committing, setCommitting] = useState(false);
  const [fulfillmentHistory, setFulfillmentHistory] = useState([]);
  const [reportOpen, setReportOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const [notifOpen, setNotifOpen] = useState(false);
  const [activeView, setActiveView] = useState('dashboard');
  const isAdmin = user?.type === 'admin';

  const showToast = useCallback((msg, kind) => {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 3500);
  }, []);

  const loadData = useCallback(async () => {
    try {
      const [sRes, iRes, nRes] = await Promise.all([
        fetch(`${config.API_URL}/api/standards`),
        fetch(`${config.API_URL}/api/requirements`),
        fetch(`${config.API_URL}/api/notifications`),
      ]);
      const s = await sRes.json();
      const i = await iRes.json();
      const n = await nRes.json();
      if (s.success) setStandards(s.data || []);
      if (i.success) setRequirementSummary(i.summary || { requirementLineCount: 0, unsupportedLineCount: 0 });
      if (n.success) setNotifications(n.items || []);
    } catch (e) {
      showToast('Failed to load data', 'error');
    }
  }, [showToast]);

  useEffect(() => { loadData(); }, [loadData]);

  const analyze = useCallback(async (standardCode, toleranceMode = 'strict', applications = []) => {
    setThinking(true);
    setResults(null);
    setDecisions({});
    setDEOverrides({});
    const wait = new Promise(r => setTimeout(r, 500));
    try {
      const res = await fetch(`${config.API_URL}/api/analyze/standard`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          standardCode,
          toleranceMode,
          applications: Array.isArray(applications) ? applications : [],
        }),
      });
      const data = await res.json();
      await wait;
      if (data.success) { setResults(data); return data; }
      showToast(data.message || 'Analysis failed', 'error');
    } catch {
      showToast('Network error during analysis', 'error');
    } finally {
      setThinking(false);
    }
    return null;
  }, [showToast]);

  const display = useMemo(
    () => buildDynamicAllocation(results, decisions, dEOverrides),
    [results, decisions, dEOverrides]
  );

  // Snapshot the default-threshold (dE = 1.0) view so we can diff old vs new in the confirm dialog.
  const baselineDisplay = useMemo(
    () => buildDynamicAllocation(results, decisions, {}),
    [results, decisions]
  );

  const handleApplyRecommended = (lineId, action) => {
    if (!action || action === 'none') return;
    setDecisions(prev => ({ ...prev, [lineId]: action }));
  };
  const handleSkip = (lineId) => setDecisions(prev => ({ ...prev, [lineId]: 'none' }));
  const handleUndo = (lineId) => {
    setDecisions(prev => {
      const next = { ...prev };
      delete next[lineId];
      return next;
    });
    setDEOverrides(prev => {
      if (!(lineId in prev)) return prev;
      const next = { ...prev };
      delete next[lineId];
      return next;
    });
  };
  const handleReset = () => { setDecisions({}); setDEOverrides({}); };
  const handleSetDeThreshold = (lineId, value) => {
    setDEOverrides(prev => {
      const num = Number(value);
      if (!Number.isFinite(num)) return prev;
      return { ...prev, [lineId]: num };
    });
  };
  const handleClearDeThreshold = (lineId) => {
    setDEOverrides(prev => {
      if (!(lineId in prev)) return prev;
      const next = { ...prev };
      delete next[lineId];
      return next;
    });
  };
  const previewWithThreshold = useCallback((lineId, threshold) => {
    if (!results) return null;
    const overrides = { ...dEOverrides, [lineId]: threshold };
    const sim = buildDynamicAllocation(results, decisions, overrides);
    return (sim?.allocation || []).find(a => a.invoiceLineId === lineId) || null;
  }, [results, decisions, dEOverrides]);

  const hasDecisions = Object.values(decisions).some(d => d === 'full' || d === 'partial');

  const handleCommit = async () => {
    if (!display || !hasDecisions) return;
    const committedRows = display.allocation
      .filter(r => (r.coverageStatus === 'full' || r.coverageStatus === 'partial') && r.allocations?.length);
    const commits = committedRows.map(r => ({
      invoiceLineId: r.invoiceLineId,
      allocations: r.allocations.map(a => ({
        lotNo: a.lotNo,
        allocatedQtyMt: a.allocatedQtyMt,
        methodId: a.methodId,
        consensusRank: a.consensusRank,
        euclideanDeltaE: a.euclideanDeltaE,
      })),
    }));
    if (commits.length === 0) {
      showToast('Nothing to commit', 'error');
      return;
    }
    // Snapshot requirement-line metadata for the report (customer, requirement #, app, requested qty)
    const linesById = Object.fromEntries(
      (display.eligibleInvoiceLines || []).map(l => [l.invoiceLineId, l])
    );
    const snapshotLines = committedRows.map(r => {
      const l = linesById[r.invoiceLineId] || {};
      return {
        invoiceLineId: r.invoiceLineId,
        invoiceNumber: l.invoiceNumber,
        customerName: l.customerName,
        application: l.application,
        qtyRequestedMt: r.qtyRequestedMt || l.qtyMt || 0,
        qtyAllocatedMt: r.qtyAllocatedMt || 0,
        shortfallMt: r.shortfallMt || 0,
        coverageStatus: r.coverageStatus,
        allocations: r.allocations.map(a => ({ ...a })),
      };
    });
    const snapshotStandard = display.standard?.standardCode;
    // Snapshot lot quantities BEFORE commit so the report can show true Original vs Remaining.
    const preCommitLots = (display.inventorySummary?.lotBreakdown || []).map(lot => ({
      lotNo: lot.lotNo,
      grade: lot.grade,
      qtyBeforeMt: lot.qtyBeforeMt,
    }));
    // Lots actually drawn from in this commit
    const touchedLotNos = new Set();
    committedRows.forEach(r => (r.allocations || []).forEach(a => touchedLotNos.add(a.lotNo)));

    setCommitting(true);
    try {
      const res = await fetch(`${config.API_URL}/api/requirements/commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: user.username || user.name,
          standardCode: snapshotStandard,
          commits,
        }),
      });
      const data = await res.json();
      if (!data.success) {
        showToast(data.message || 'Commit failed', 'error');
      } else {
        showToast(`Locked in: ${data.linesAffected} line(s), ${data.lotMovements} lot movement(s)`);
        await loadData();
        let remainingLots = [];
        if (snapshotStandard) {
          const fresh = await analyze(snapshotStandard);
          // Backend's qtyRemainingMt reflects its own auto-reallocation against fresh stock.
          // qtyBeforeMt comes from inventory_lots.qty_mt_on_hand (already decremented by commit),
          // so it's the actual remaining stock. Pair with the pre-commit snapshot for "Original".
          const freshByLot = Object.fromEntries(
            (fresh?.inventorySummary?.lotBreakdown || []).map(l => [l.lotNo, l])
          );
          const preByLot = Object.fromEntries(preCommitLots.map(l => [l.lotNo, l]));
          const allLotNos = new Set([...Object.keys(freshByLot), ...Object.keys(preByLot)]);
          remainingLots = Array.from(allLotNos).sort().map(lotNo => {
            const f = freshByLot[lotNo] || {};
            const p = preByLot[lotNo] || {};
            return {
              lotNo,
              grade: f.grade || p.grade,
              qtyRemainingMt: f.qtyBeforeMt ?? 0,
              qtyBeforeMt: p.qtyBeforeMt ?? f.qtyBeforeMt ?? 0,
              touched: touchedLotNos.has(lotNo),
            };
          });
        }
        const report = {
          id: `rpt-${Date.now()}`,
          timestamp: new Date().toISOString(),
          standardCode: snapshotStandard,
          user: user.username || user.name,
          linesAffected: data.linesAffected,
          lotMovements: data.lotMovements,
          lines: snapshotLines,
          remainingLots,
        };
        setFulfillmentHistory(prev => [report, ...prev]);
        setReportOpen(true);
        setDecisions({});
      }
    } catch {
      showToast('Network error during commit', 'error');
    } finally {
      setCommitting(false);
    }
  };

  const [resetting, setResetting] = useState(false);
  const handleResetDemo = async () => {
    if (resetting) return;
    if (!window.confirm('Reset demo data? This will restore inventory and requirement lines to their original state and clear the commit audit log.')) return;
    setResetting(true);
    try {
      const res = await fetch(`${config.API_URL}/api/demo/reset`, { method: 'POST' });
      const data = await res.json();
      if (!data.success) {
        showToast(data.message || 'Reset failed', 'error');
      } else {
        showToast('Demo data reset');
        setResults(null);
        setDecisions({});
        await loadData();
      }
    } catch {
      showToast('Network error during reset', 'error');
    } finally {
      setResetting(false);
    }
  };

  const handleNotifClick = (n) => {
    setNotifOpen(false);
    if (n.standardCode) analyze(n.standardCode);
  };

  // Header KPIs derived from current display (live with decisions)
  const inv = display?.inventorySummary || {};
  const ia = display?.inventoryAnalysis || {};
  const stockLive = inv.totalAfterMt ?? inv.totalBeforeMt ?? 0;
  const allocated = inv.totalAllocatedMt || 0;
  const demandBase = ia.supportedDemandMt || 0;
  const demandLive = ia.supportedShortfallMt ?? ia.supportedDemandMt ?? 0;
  const coveragePct = demandBase > 0 ? Math.min(100, (allocated / demandBase) * 100) : 0;
  const appliedCount = Object.values(decisions).filter(d => d === 'full' || d === 'partial').length;
  const isSimulating = appliedCount > 0 && !committing;

  return (
    <>
      <div className="app-background" />
      <header className="app-header">
        <div className="ah-brand">
          <img src="/logos/partner1.png" alt="Partner logo" className="ah-brand-logo" />
          <div className="ah-brand-title">SIOP</div>
        </div>

        {display ? (
          <div className="ah-kpis">
            <div className="ah-chip">
              <span className="ah-chip-label">Standard</span>
              <span className="ah-chip-value">{display.standard?.standardCode}</span>
            </div>
            <div className="ah-chip">
              <span className="ah-chip-label">Stock</span>
              <span className="ah-chip-value">{Number(stockLive).toFixed(1)}<span className="unit">MT</span></span>
            </div>
            <div className="ah-chip">
              <span className="ah-chip-label">Demand</span>
              <span className="ah-chip-value">{Number(demandLive).toFixed(1)}<span className="unit">MT</span></span>
            </div>
            <div className="ah-chip ah-chip-coverage">
              <span className="ah-chip-label">Coverage</span>
              <span className="ah-chip-value">{coveragePct.toFixed(0)}<span className="unit">%</span></span>
              <div className="ah-chip-bar"><div className="ah-chip-bar-fill" style={{ width: `${coveragePct}%` }} /></div>
            </div>
            {isSimulating && (
              <div className="ah-kpis-note">Simulated numbers, not locked in</div>
            )}
          </div>
        ) : (
          <div className="ah-kpis ah-kpis-empty">
            <span>{standards.length} standards - {(requirementSummary.openRequirementCount ?? requirementSummary.requirementCount ?? 0)} open requirements</span>
          </div>
        )}

        <div className="ah-actions">
          <div className="notif-wrap">
            <button className="ah-icon-btn" type="button" onClick={() => setNotifOpen(o => !o)} title="Carried over">
              <BellIcon />
              {notifications.length > 0 && <span className="ah-icon-dot">{notifications.length}</span>}
            </button>
            {notifOpen && (
              <div className="notif-panel ah-notif-panel">
                {notifications.length === 0 ? (
                  <div className="notif-panel-empty">No partial fulfillments outstanding.</div>
                ) : (
                  notifications.map(n => (
                    <div className="notif-item" key={n.invoiceLineId} onClick={() => handleNotifClick(n)}>
                      <div className="notif-item-head">
                        <span className="notif-item-id">{n.invoiceNumber}</span>
                        <span className="notif-item-std">{n.standardCode}</span>
                      </div>
                      <div className="notif-item-customer">{n.customerName}</div>
                      <div className="notif-item-qty">
                        {n.outstandingQtyMt.toFixed(2)} of {n.originalQtyMt.toFixed(2)} MT outstanding
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          <button
            className="btn btn-sm btn-ghost ah-reset"
            type="button"
            disabled={resetting}
            onClick={handleResetDemo}
            title="Restore inventory and requirement lines to baseline"
          >
            {resetting ? 'Resetting...' : 'Reset demo'}
          </button>

          <button
            className="btn btn-primary ah-lockin"
            type="button"
            disabled={!display || !hasDecisions || committing}
            onClick={handleCommit}
            title={hasDecisions ? `Lock in ${appliedCount} decision(s)` : 'Apply at least one decision to lock in'}
          >
            {committing ? 'Locking...' : hasDecisions ? `Lock in ${appliedCount}` : 'Lock in'}
          </button>

          <div className="ah-user">
            <div className="ah-user-name">{user.name}</div>
            <button className="btn btn-sm btn-ghost" onClick={onLogout} type="button">Sign out</button>
          </div>
        </div>
      </header>

      <div className="app-shell">
        {thinking && activeView !== 'update' && <ThinkingScreen />}
        <main className="main-stack">
          {isAdmin && (
            <div className="view-switch">
              <button
                type="button"
                className={`view-switch-btn ${activeView === 'dashboard' ? 'active' : ''}`}
                onClick={() => setActiveView('dashboard')}
              >
                Dashboard
              </button>
              <button
                type="button"
                className={`view-switch-btn ${activeView === 'update' ? 'active' : ''}`}
                onClick={() => setActiveView('update')}
              >
                Update Data
              </button>
            </div>
          )}

          {activeView === 'dashboard' && (
            <>
              <div className="page-header">
                <h1 className="page-title">Customer Match Matrix</h1>
                <p className="page-subtitle">Simulate fulfillment across open requirements, then lock it in.</p>
              </div>

              <PigmentSelector
                standards={standards}
                onSelect={analyze}
                loading={thinking}
                selectedStandard={display?.standard}
              />

              {display && <InventoryGlance display={display} />}

              {display && (
                <ResultsTabs
                  results={display}
                  baselineResults={baselineDisplay}
                  decisions={decisions}
                  dEOverrides={dEOverrides}
                  onApplyRecommended={handleApplyRecommended}
                  onSkip={handleSkip}
                  onUndo={handleUndo}
                  onResetDecisions={handleReset}
                  onSetDeThreshold={handleSetDeThreshold}
                  onClearDeThreshold={handleClearDeThreshold}
                  previewWithThreshold={previewWithThreshold}
                  fulfillmentHistory={fulfillmentHistory}
                  reportOpen={reportOpen}
                  onOpenReport={() => setReportOpen(true)}
                  onCloseReport={() => setReportOpen(false)}
                  isAdmin={isAdmin}
                  onOpenMatchingFlow={() => setActiveView('flow')}
                />
              )}
            </>
          )}

          {activeView === 'flow' && isAdmin && (
            <>
              <div className="page-header page-header-with-action">
                <div>
                  <h1 className="page-title">Flow Audit</h1>
                  <p className="page-subtitle">Audit queue order, stock depletion, and why each line lands as full, partial, or blocked.</p>
                </div>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={() => setActiveView('dashboard')}
                >
                  Back to dashboard
                </button>
              </div>
              <MatchingFlowTab results={results} />
            </>
          )}

          {activeView === 'update' && isAdmin && (
            <UpdateDataTab
              user={user}
              onToast={showToast}
              onAfterChange={loadData}
            />
          )}
        </main>
      </div>
      <Toast msg={toast?.msg} kind={toast?.kind} />
    </>
  );
}

export default Dashboard;
