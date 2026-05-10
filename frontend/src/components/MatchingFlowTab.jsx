import React, { useMemo } from 'react';

const fmt = (value, digits = 2) => (Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : '-');
const fmtInt = (value) => (Number.isFinite(Number(value)) ? Number(value).toFixed(0) : '-');
const rank = (value) => (Number.isFinite(Number(value)) ? `#${Number(value)}` : '#-');
const testsLabel = (tests = []) => (Array.isArray(tests) && tests.length ? tests.join(', ') : '-');

const perceptTone = (key) => {
  if (key === 'imperceptible' || key === 'slight') return 'good';
  if (key === 'noticeable') return 'info';
  if (key === 'distinct') return 'warn';
  if (key === 'obvious') return 'bad';
  return 'muted';
};

const outcomeTone = (status) => {
  if (status === 'full') return 'good';
  if (status === 'partial') return 'warn';
  if (status === 'unfulfilled') return 'bad';
  return 'muted';
};

const outcomeLabel = (status) => {
  if (status === 'full') return 'Full';
  if (status === 'partial') return 'Partial';
  if (status === 'unfulfilled') return "Can't fulfill";
  if (status === 'unsupported') return 'Unsupported';
  return 'Pending';
};

const sortByRank = (candidates = []) =>
  candidates.slice().sort((a, b) => {
    const ar = a.consensusRank ?? 9999;
    const br = b.consensusRank ?? 9999;
    if (ar !== br) return ar - br;
    return (a.lotNo || '').localeCompare(b.lotNo || '');
  });

const buildEuclideanFormula = (line, candidate) => {
  const td = line?.targetDelta || {};
  const dL = Number(candidate?.deltaL);
  const dA = Number(candidate?.deltaA);
  const dB = Number(candidate?.deltaB);
  const tL = Number(td?.dL);
  const tA = Number(td?.dA);
  const tB = Number(td?.dB);
  if (![dL, dA, dB, tL, tA, tB].every(Number.isFinite)) return null;
  return `sqrt((${fmt(dL, 3)} - ${fmt(tL, 3)})^2 + (${fmt(dA, 3)} - ${fmt(tA, 3)})^2 + (${fmt(dB, 3)} - ${fmt(tB, 3)})^2) = ${fmt(candidate?.euclideanDeltaE, 4)}`;
};

const buildConsensusSummary = (candidate) => {
  if (!candidate) return null;
  return [
    `consensus ${rank(candidate.consensusRank)}`,
    `score ${fmt(candidate.consensusScore, 3)}%`,
    `euclidean ${rank(candidate.euclideanRank)}`,
    `cosine ${rank(candidate.cosineRank)}`,
    `knn ${rank(candidate.knnRank)}`,
  ].join(' - ');
};

const buildCosineFormula = (line, candidate) => {
  const td = line?.targetDelta || {};
  const q = [Number(td?.dL), Number(td?.dA), Number(td?.dB)];
  const l = [Number(candidate?.deltaL), Number(candidate?.deltaA), Number(candidate?.deltaB)];
  if (![...q, ...l].every(Number.isFinite)) return null;
  const qNorm = Math.sqrt(q.reduce((sum, value) => sum + value ** 2, 0));
  const lNorm = Math.sqrt(l.reduce((sum, value) => sum + value ** 2, 0));
  return `cos = ((${fmt(q[0], 3)}*${fmt(l[0], 3)}) + (${fmt(q[1], 3)}*${fmt(l[1], 3)}) + (${fmt(q[2], 3)}*${fmt(l[2], 3)})) / (${fmt(qNorm, 4)} * ${fmt(lNorm, 4)}) = ${fmt(candidate?.cosineSimilarity, 6)}`;
};

const scaleFeature = (value, mean, scale) => {
  if (!Number.isFinite(value) || !Number.isFinite(mean)) return null;
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  return (value - mean) / safeScale;
};

const buildKnnFormula = (line, candidate, candidates) => {
  const td = line?.targetDelta || {};
  const query = [Number(td?.dL), Number(td?.dA), Number(td?.dB)];
  const rows = (candidates || [])
    .map((item) => [Number(item?.deltaL), Number(item?.deltaA), Number(item?.deltaB)])
    .filter((row) => row.every(Number.isFinite));
  const lot = [Number(candidate?.deltaL), Number(candidate?.deltaA), Number(candidate?.deltaB)];
  if (![...query, ...lot].every(Number.isFinite) || rows.length === 0) return null;

  const means = [0, 1, 2].map((index) => rows.reduce((sum, row) => sum + row[index], 0) / rows.length);
  const scales = [0, 1, 2].map((index) => {
    const variance = rows.reduce((sum, row) => sum + (row[index] - means[index]) ** 2, 0) / rows.length;
    return Math.sqrt(variance) || 1;
  });

  const scaledQuery = query.map((value, index) => scaleFeature(value, means[index], scales[index]));
  const scaledLot = lot.map((value, index) => scaleFeature(value, means[index], scales[index]));
  const distance = Math.sqrt(
    scaledQuery.reduce((sum, value, index) => sum + (value - scaledLot[index]) ** 2, 0)
  );

  return `knn = sqrt((${fmt(scaledLot[0], 3)} - ${fmt(scaledQuery[0], 3)})^2 + (${fmt(scaledLot[1], 3)} - ${fmt(scaledQuery[1], 3)})^2 + (${fmt(scaledLot[2], 3)} - ${fmt(scaledQuery[2], 3)})^2) = ${fmt(candidate?.knnDistance ?? distance, 6)}`;
};

const describeTargetVector = (line) => {
  const source = line?.targetDelta?.source;
  if (source === 'invoice_delta_lab') {
    return {
      kicker: 'Requirement delta target',
      note: 'This line already carries requirement dL / dA / dB, so the matcher scores lots directly against those delta values.',
      valueLabels: ['dL', 'dA', 'dB'],
      showReference: false,
    };
  }
  if (source === 'delta_from_standard') {
    return {
      kicker: 'Derived delta target',
      note: 'Fallback path: requirement absolute LAB was converted to dL / dA / dB using the resolved reference profile.',
      valueLabels: ['dL', 'dA', 'dB'],
      showReference: true,
    };
  }
  return {
    kicker: 'Target delta',
    note: null,
    valueLabels: ['dL', 'dA', 'dB'],
    showReference: false,
  };
};

const queueSort = (a, b) => {
  const ar = a.fulfillabilityRank ?? 9999;
  const br = b.fulfillabilityRank ?? 9999;
  if (ar !== br) return ar - br;
  return (a.invoiceLineId || '').localeCompare(b.invoiceLineId || '');
};

const buildAuditModel = (results) => {
  if (!results) return null;

  const lines = results.eligibleInvoiceLines || [];
  const allocations = results.allocation || [];
  const allocByLine = Object.fromEntries(allocations.map((row) => [row.invoiceLineId, row]));
  const candidatesByLine = results.lotCandidatesByInvoiceLine || {};
  const inventory = results.inventorySummary || {};
  const analysis = results.inventoryAnalysis || {};

  const supportedLines = lines.filter((line) => line.isSupported).slice().sort(queueSort);
  const unsupportedLines = lines.filter((line) => !line.isSupported).slice().sort(queueSort);

  const queueRows = supportedLines.map((line) => {
    const allocation = allocByLine[line.invoiceLineId] || null;
    const candidates = sortByRank(candidatesByLine[line.invoiceLineId] || []);
    return {
      line,
      allocation,
      candidates,
      estimatedEligibleQtyMt: Number(line.estimatedEligibleQtyMt || 0),
      liveEligibleQtyMt: Number(allocation?.liveEligibleQtyMt ?? 0),
      coverageStatus: allocation?.coverageStatus || 'pending',
    };
  });

  const fullExample = queueRows.find((row) => row.coverageStatus === 'full' && row.allocation?.allocations?.length) || null;
  const partialExample = queueRows.find((row) => row.coverageStatus === 'partial') || null;
  const blockedExample = queueRows.find((row) => row.coverageStatus === 'unfulfilled') || null;
  const depletionExample =
    partialExample ||
    queueRows.find((row) => row.estimatedEligibleQtyMt > row.liveEligibleQtyMt + 0.001) ||
    null;

  return {
    lines,
    allocations,
    allocByLine,
    candidatesByLine,
    inventory,
    analysis,
    supportedLines,
    unsupportedLines,
    queueRows,
    fullExample,
    partialExample,
    blockedExample,
    depletionExample,
    fullCount: allocations.filter((row) => row.coverageStatus === 'full').length,
    partialCount: allocations.filter((row) => row.coverageStatus === 'partial').length,
    blockedCount: allocations.filter((row) => row.coverageStatus === 'unfulfilled').length,
    unsupportedCount: allocations.filter((row) => row.coverageStatus === 'unsupported').length,
  };
};

const PHASES = [
  {
    id: 'scope',
    label: 'Scope',
    steps: [
      {
        step: 1,
        title: 'Choose the current standard',
        body: 'The operator still starts from the running standard. That choice defines which inventory lots and QC tests are available to the match engine.',
        detail: 'Requirement demand is then routed by the standard color family, not by a separate customer filter.',
      },
      {
        step: 2,
        title: 'Load only open lines with remaining qty',
        body: 'The queue contains open requirement lines for that color only. Carried partials stay in the queue with their remaining quantity.',
        detail: 'This compact demo pack was rebuilt so every color has real full, partial, and blocked shortage cases.',
      },
    ],
  },
  {
    id: 'rank',
    label: 'Rank',
    steps: [
      {
        step: 3,
        title: 'Resolve test method and target vector',
        body: 'Requirement-specific tests win when present. Otherwise matching starts from the base test and falls through only when availability requires it.',
        detail: 'dL / dA / dB from the requirement remain the primary scoring target for every candidate lot.',
      },
      {
        step: 4,
        title: 'Score and filter candidate lots',
        body: 'Euclidean dE, cosine similarity, and KNN distance are ranked into a consensus order, then filtered by the active tolerance band.',
        detail: 'The page audits both the starting eligible quantity and the live eligible quantity after earlier lines consume stock.',
      },
    ],
  },
  {
    id: 'outcome',
    label: 'Outcome',
    steps: [
      {
        step: 5,
        title: 'Allocate against the shared live stock pool',
        body: 'Lines are processed in fulfillability order. Earlier lines can drain the best lots, which is how later lines become partial or fully blocked.',
        detail: 'Queue order is: carried partials first, then fulfillability rank, then line id.',
      },
      {
        step: 6,
        title: 'Apply decisions, then lock in',
        body: 'The dashboard turns that engine audit into operator actions: fulfill, partially fulfill, skip, or cannot fulfill. Lock-in decrements inventory and leaves shortfalls open.',
        detail: 'This audit page explains why the recommendation landed where it did before anything is committed.',
      },
    ],
  },
];

const FLAT_STEPS = PHASES.flatMap((phase) =>
  phase.steps.map((step) => ({ ...step, phaseId: phase.id, phaseLabel: phase.label }))
);

function StepCard({ step }) {
  return (
    <div className="mf-step" data-phase={step.phaseId}>
      <div className="mf-step-tag">{step.phaseLabel}</div>
      <div className="mf-step-num">{step.step}</div>
      <div className="mf-step-title">{step.title}</div>
      <div className="mf-step-copy">{step.body}</div>
      {step.detail && <div className="mf-step-detail">{step.detail}</div>}
    </div>
  );
}

function StatChip({ label, value, sub }) {
  return (
    <div className="mf-stat">
      <div className="mf-stat-label">{label}</div>
      <div className="mf-stat-value">{value}</div>
      {sub && <div className="mf-stat-sub">{sub}</div>}
    </div>
  );
}

function ExampleHeader({ title, subtitle, rankChip, tone }) {
  return (
    <div className="mf-ex-head">
      <div className="mf-ex-head-main">
        <div className="mf-ex-head-title">{title}</div>
        <div className="mf-ex-head-sub">{subtitle}</div>
      </div>
      <div className={`mf-ex-rank ${tone}`}>
        <span>Queue</span>
        <strong>{rankChip}</strong>
      </div>
    </div>
  );
}

function ExampleMeta({ line, allocation }) {
  return (
    <div className="mf-meta-row">
      <div className="mf-meta-cell">
        <span className="mf-meta-label">Requirement</span>
        <span className="mf-meta-val">{line.invoiceNumber}</span>
        <span className="mf-meta-aux">{line.customerName}</span>
      </div>
      <div className="mf-meta-cell">
        <span className="mf-meta-label">Requested</span>
        <span className="mf-meta-val">{fmt(line.qtyMt)} MT</span>
        <span className="mf-meta-aux">{line.application || 'No application'}</span>
      </div>
      <div className="mf-meta-cell">
        <span className="mf-meta-label">Match test</span>
        <span className="mf-meta-val mono">{line.resolvedMethodId}</span>
        <span className="mf-meta-aux">{line.targetMethodId || 'base-test fallback'}</span>
      </div>
      <div className="mf-meta-cell">
        <span className="mf-meta-label">Outcome</span>
        <span className="mf-meta-val">{outcomeLabel(allocation?.coverageStatus)}</span>
        <span className="mf-meta-aux">
          {fmt(allocation?.qtyAllocatedMt || 0)} / {fmt(allocation?.qtyRequestedMt || line.qtyMt)} MT
        </span>
      </div>
    </div>
  );
}

function CandidateTable({ line, candidates, showLive = false, topRank = null }) {
  return (
    <div className="mf-table-wrap">
      <table className="mf-table">
        <thead>
          <tr>
            <th>Lot</th>
            <th>Match test</th>
            <th>Lot tests</th>
            <th>Consensus</th>
            <th>dE</th>
            <th>Cosine</th>
            <th>KNN</th>
            <th className="mf-col-num">Start MT</th>
            {showLive && <th className="mf-col-num">Live MT</th>}
            <th>Perceptual</th>
          </tr>
        </thead>
        <tbody>
          {candidates.map((candidate) => {
            const tone = perceptTone(candidate?.perceptual?.key);
            const isTop = topRank !== null && candidate.consensusRank === topRank;
            const depleted = showLive && Number(candidate.availableQtyMt || 0) > 0 && Number(candidate.liveAvailableQtyMt || 0) <= 0;
            return (
              <tr
                key={`${line.invoiceLineId}-${candidate.lotNo}-${candidate.consensusRank}`}
                className={`${isTop ? 'is-top' : ''} ${depleted ? 'is-depleted' : ''}`.trim()}
              >
                <td className="mono">
                  {candidate.lotNo}{candidate.isSuperLot ? ' *' : ''}
                </td>
                <td className="mono">{candidate.matchMethodId || candidate.methodId}</td>
                <td className="mono">{testsLabel(candidate.availableTests)}</td>
                <td><strong>{rank(candidate.consensusRank)}</strong></td>
                <td>{fmt(candidate.euclideanDeltaE, 4)}</td>
                <td>{fmt(candidate.cosineSimilarity, 4)}</td>
                <td>{fmt(candidate.knnDistance, 4)}</td>
                <td className="mf-col-num">{fmt(candidate.availableQtyMt)}</td>
                {showLive && <td className="mf-col-num">{fmt(candidate.liveAvailableQtyMt)}</td>}
                <td>
                  <span className={`mf-percept ${tone}`}>{candidate?.perceptual?.label || 'Unknown'}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function AllocationList({ allocation, emptyCopy }) {
  if (!allocation?.allocations?.length) {
    return <div className="mf-inline-note">{emptyCopy || 'No stock was allocated for this line.'}</div>;
  }
  return (
    <div className="mf-alloc-list">
      {allocation.allocations.map((item) => (
        <div className="mf-alloc-row" key={`${allocation.invoiceLineId}-${item.lotNo}`}>
          <div className="mf-alloc-rank">{rank(item.consensusRank)}</div>
          <div className="mf-alloc-mid">
            <div className="mf-alloc-lot">{item.lotNo}</div>
            <div className="mf-alloc-meta">
              dE {fmt(item.euclideanDeltaE, 4)} <span className="mf-dot" /> KNN {fmt(item.knnDistance, 4)}
              <span className="mf-dot" /> {item.matchMethodId || item.methodId}
              {item.availableTests?.length ? ` - tests ${item.availableTests.join(', ')}` : ''}
            </div>
          </div>
          <div className="mf-alloc-qty">{fmt(item.allocatedQtyMt)} MT</div>
        </div>
      ))}
    </div>
  );
}

function QueueAuditTable({ rows }) {
  return (
    <div className="mf-table-wrap">
      <table className="mf-table">
        <thead>
          <tr>
            <th>Rank</th>
            <th>Requirement</th>
            <th>Grade / Std</th>
            <th>Application</th>
            <th className="mf-col-num">Req MT</th>
            <th className="mf-col-num">Start elig</th>
            <th className="mf-col-num">Live elig</th>
            <th className="mf-col-num">Alloc MT</th>
            <th className="mf-col-num">Shortfall</th>
            <th>Outcome</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ line, allocation, estimatedEligibleQtyMt, liveEligibleQtyMt, coverageStatus }) => (
            <tr key={line.invoiceLineId}>
              <td><strong>{rank(line.fulfillabilityRank)}</strong></td>
              <td>
                <div>{line.invoiceNumber}</div>
                <div className="mf-meta-aux">{line.customerName}</div>
              </td>
              <td className="mono">
                {line.grade} / {line.standardCode}
              </td>
              <td>{line.application || '-'}</td>
              <td className="mf-col-num">{fmt(line.qtyMt)}</td>
              <td className="mf-col-num">{fmt(estimatedEligibleQtyMt)}</td>
              <td className="mf-col-num">{fmt(liveEligibleQtyMt)}</td>
              <td className="mf-col-num">{fmt(allocation?.qtyAllocatedMt || 0)}</td>
              <td className="mf-col-num">{fmt(allocation?.shortfallMt || 0)}</td>
              <td>
                <span className={`mf-percept ${outcomeTone(coverageStatus)}`}>{outcomeLabel(coverageStatus)}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function MatchingFlowTab({ results }) {
  const audit = useMemo(() => buildAuditModel(results), [results]);

  if (!results || !audit) {
    return (
      <div className="mf-root">
        <div className="mf-hero">
          <div className="mf-hero-main">
            <div className="mf-eyebrow">Flow audit</div>
            <h2 className="mf-title">Match engine walkthrough</h2>
            <p className="mf-subtitle">
              Run a standard analysis first. This page then audits the ranking, shortage, and live-allocation logic behind that result.
            </p>
          </div>
        </div>
        <div className="mf-empty">
          <div className="mf-empty-title">No analysis loaded yet</div>
          <div className="mf-empty-copy">
            Pick a standard in the dashboard, then open Flow audit to trace how the engine handled that color.
          </div>
        </div>
      </div>
    );
  }

  const standard = results.standard || {};
  const inventory = audit.inventory || {};
  const analysis = audit.analysis || {};

  const fullExample = audit.fullExample;
  const partialExample = audit.partialExample;
  const blockedExample = audit.blockedExample;

  const fullLine = fullExample?.line || null;
  const fullAllocation = fullExample?.allocation || null;
  const fullCandidatesAll = fullExample ? fullExample.candidates : [];
  const fullCandidates = fullCandidatesAll.slice(0, 5);
  const fullTop = fullCandidates[0];
  const fullConsensus = fullTop ? buildConsensusSummary(fullTop) : null;
  const fullEuclidean = fullLine && fullTop ? buildEuclideanFormula(fullLine, fullTop) : null;
  const fullCosine = fullLine && fullTop ? buildCosineFormula(fullLine, fullTop) : null;
  const fullKnn = fullLine && fullTop ? buildKnnFormula(fullLine, fullTop, fullCandidatesAll) : null;
  const fullTargetVector = describeTargetVector(fullLine);

  const partialLine = partialExample?.line || null;
  const partialAllocation = partialExample?.allocation || null;
  const partialCandidates = partialExample ? partialExample.candidates.slice(0, 8) : [];
  const partialDepletedLots = partialCandidates.filter(
    (candidate) => Number(candidate.availableQtyMt || 0) > 0 && Number(candidate.liveAvailableQtyMt || 0) <= 0
  );
  const partialGap = partialExample
    ? Number(partialExample.estimatedEligibleQtyMt || 0) - Number(partialExample.liveEligibleQtyMt || 0)
    : 0;

  const blockedLine = blockedExample?.line || null;
  const blockedAllocation = blockedExample?.allocation || null;
  const blockedCandidates = blockedExample ? blockedExample.candidates.slice(0, 8) : [];

  return (
    <div className="mf-root">
      <div className="mf-hero">
        <div className="mf-hero-main">
          <div className="mf-eyebrow">
            Flow audit - inventory scope {standard.standardCode || '-'}{standard.colorFamily ? ` - ${standard.colorFamily}` : ''}
          </div>
          <h2 className="mf-title">Match engine walkthrough</h2>
          <p className="mf-subtitle">
            Audit of the new compact flow: select the running standard, pull open demand for that color, rank lots, and see which lines become full, partial, or blocked before anyone locks stock.
          </p>
        </div>
        <div className="mf-hero-stats">
          <StatChip label="Color" value={standard.colorFamily || '-'} />
          <StatChip label="Open lines" value={fmtInt(audit.lines.length)} sub={`${fmt(analysis.supportedDemandMt || 0)} MT demand`} />
          <StatChip label="Full" value={fmtInt(audit.fullCount)} />
          <StatChip label="Partial" value={fmtInt(audit.partialCount)} />
          <StatChip label="Blocked" value={fmtInt(audit.blockedCount)} sub={audit.unsupportedCount ? `${fmtInt(audit.unsupportedCount)} unsupported` : 'inventory shortage'} />
          <StatChip label="Stock left" value={fmt(inventory.totalAfterMt || 0)} sub={`from ${fmt(inventory.totalBeforeMt || 0)} MT`} />
        </div>
      </div>

      <div className="mf-flow">
        {FLAT_STEPS.map((step) => (
          <StepCard key={step.step} step={step} />
        ))}
      </div>

      {fullLine && fullAllocation && (
        <div className="mf-panel">
          <ExampleHeader
            title="Example A - full fill on the first pass"
            subtitle="This line reached the queue while its best-ranked lot still had enough stock, so the recommendation stayed straightforward."
            rankChip={fmtInt(fullLine.fulfillabilityRank)}
            tone="good"
          />

          <ExampleMeta line={fullLine} allocation={fullAllocation} />

          <div className="mf-split">
            <div className="mf-split-col">
              <div className="mf-split-kicker">{fullTargetVector.kicker}</div>
              {fullTargetVector.showReference && (
                <div className="mf-lab-strip">
                  <div className="mf-lab"><span>L</span><strong>{fmt(fullLine.referenceLab?.L, 3)}</strong></div>
                  <div className="mf-lab"><span>a</span><strong>{fmt(fullLine.referenceLab?.a, 3)}</strong></div>
                  <div className="mf-lab"><span>b</span><strong>{fmt(fullLine.referenceLab?.b, 3)}</strong></div>
                </div>
              )}
              <div className={`mf-delta-strip ${fullTargetVector.showReference ? 'has-reference' : ''}`.trim()}>
                <div className="mf-delta"><span>{fullTargetVector.valueLabels[0]}</span><strong>{fmt(fullLine.targetDelta?.dL, 3)}</strong></div>
                <div className="mf-delta"><span>{fullTargetVector.valueLabels[1]}</span><strong>{fmt(fullLine.targetDelta?.dA, 3)}</strong></div>
                <div className="mf-delta"><span>{fullTargetVector.valueLabels[2]}</span><strong>{fmt(fullLine.targetDelta?.dB, 3)}</strong></div>
              </div>
              {fullTargetVector.note && <div className="mf-split-body">{fullTargetVector.note}</div>}
            </div>
            <div className="mf-split-col">
              <div className="mf-split-kicker">Consensus breakdown</div>
              <div className="mf-rank-strip">
                <span className="mf-rank-pill">Euclidean {rank(fullTop?.euclideanRank)}</span>
                <span className="mf-rank-pill">Cosine {rank(fullTop?.cosineRank)}</span>
                <span className="mf-rank-pill">KNN {rank(fullTop?.knnRank)}</span>
              </div>
              {fullConsensus && <div className="mf-split-body">{fullConsensus}</div>}
              <details className="mf-math">
                <summary>Show math</summary>
                {fullEuclidean && <div className="mf-math-line">{fullEuclidean}</div>}
                {fullCosine && <div className="mf-math-line">{fullCosine}</div>}
                {fullKnn && <div className="mf-math-line">{fullKnn}</div>}
              </details>
            </div>
          </div>

          <CandidateTable line={fullLine} candidates={fullCandidates} topRank={fullTop?.consensusRank ?? null} />

          <div className="mf-outcome good">
            <div className="mf-outcome-label">What this proves</div>
            <div className="mf-outcome-body">
              The compact flow still preserves a clean success case: the line asked for <strong>{fmt(fullAllocation.qtyRequestedMt)} MT</strong> and the engine found enough stock in its top-ranked pool to allocate the full quantity immediately.
            </div>
          </div>
        </div>
      )}

      {partialLine && partialAllocation && (
        <div className="mf-panel">
          <ExampleHeader
            title="Example B - partial because earlier lines consumed shared stock"
            subtitle="Ranking is calculated per line, but the actual draw uses one live stock pool. By the time this line is reached, the earlier queue has already drained part of its best inventory."
            rankChip={fmtInt(partialLine.fulfillabilityRank)}
            tone="warn"
          />

          <ExampleMeta line={partialLine} allocation={partialAllocation} />

          <div className="mf-vs">
            <div className="mf-vs-col">
              <div className="mf-vs-kicker">At ranking time</div>
              <div className="mf-vs-number">{fmt(partialExample?.estimatedEligibleQtyMt)} <span>MT</span></div>
              <div className="mf-vs-sub">Eligible stock before any earlier line pulled from the pool.</div>
            </div>
            <div className="mf-vs-arrow">
              <span>{fmt(partialGap)} MT consumed before this line</span>
            </div>
            <div className="mf-vs-col danger">
              <div className="mf-vs-kicker">At allocation time</div>
              <div className="mf-vs-number">{fmt(partialExample?.liveEligibleQtyMt)} <span>MT</span></div>
              <div className="mf-vs-sub">Live eligible stock left when this queue position was actually processed.</div>
            </div>
          </div>

          <CandidateTable line={partialLine} candidates={partialCandidates} showLive />

          {partialDepletedLots.length > 0 && (
            <div className="mf-inline-note danger">
              <strong>Already drained before this line:</strong> {partialDepletedLots.map((candidate) => candidate.lotNo).join(', ')}.
            </div>
          )}

          <div className="mf-alloc-section">
            <div className="mf-alloc-title">Actual draws</div>
            <AllocationList allocation={partialAllocation} />
          </div>
        </div>
      )}

      {blockedLine && blockedAllocation && (
        <div className="mf-panel">
          <ExampleHeader
            title="Example C - blocked by inventory shortage"
            subtitle="This line still belongs to the selected color and passed matching, but the queue reached it after the usable stock was gone."
            rankChip={fmtInt(blockedLine.fulfillabilityRank)}
            tone="warn"
          />

          <ExampleMeta line={blockedLine} allocation={blockedAllocation} />

          <div className="mf-vs">
            <div className="mf-vs-col">
              <div className="mf-vs-kicker">Starting eligible stock</div>
              <div className="mf-vs-number">{fmt(blockedExample?.estimatedEligibleQtyMt)} <span>MT</span></div>
              <div className="mf-vs-sub">What the ranking stage could see before queue depletion.</div>
            </div>
            <div className="mf-vs-arrow">
              <span>all usable stock was consumed earlier</span>
            </div>
            <div className="mf-vs-col danger">
              <div className="mf-vs-kicker">Live eligible stock</div>
              <div className="mf-vs-number">{fmt(blockedExample?.liveEligibleQtyMt)} <span>MT</span></div>
              <div className="mf-vs-sub">Nothing remained for this line at its queue position.</div>
            </div>
          </div>

          <CandidateTable line={blockedLine} candidates={blockedCandidates} showLive />

          <div className="mf-alloc-section">
            <div className="mf-alloc-title">Actual draws</div>
            <AllocationList
              allocation={blockedAllocation}
              emptyCopy="No lots were drawn. This is a stock-shortage block, not an unsupported-grade block."
            />
          </div>
        </div>
      )}

      <div className="mf-panel">
        <div className="mf-panel-title-row">
          <div className="mf-panel-title">Queue audit</div>
          <div className="mf-panel-sub">Every supported line in fulfillability order, with both starting and live eligible stock.</div>
        </div>

        <div className="mf-inline-note">
          Earlier lines can shrink the live eligible quantity even when the starting eligible quantity looked healthy. That gap is the heart of the new shortage demo.
        </div>

        <QueueAuditTable rows={audit.queueRows} />
      </div>

      <div className="mf-panel">
        <div className="mf-panel-title-row">
          <div className="mf-panel-title">Guardrails</div>
          <div className="mf-panel-sub">Details that mattered during the audit, not just the headline statuses.</div>
        </div>

        <div className="mf-guards">
          <div className="mf-guard">
            <div className="mf-guard-kicker">Inventory-backed shortages</div>
            <div className="mf-guard-title">Partial and blocked lines now come from real stock pressure</div>
            <div className="mf-guard-copy">
              This demo pack was rebuilt from the live inventory totals, so shortage behavior is driven by actual quantity exhaustion rather than unsupported placeholder rows.
            </div>
          </div>
          <div className="mf-guard">
            <div className="mf-guard-kicker">Customer codes preserved</div>
            <div className="mf-guard-title">Requirement rows keep customer-facing grade and standard labels</div>
            <div className="mf-guard-copy">
              The selected inventory scope is <strong>{standard.standardCode || '-'}</strong>, while requirement lines still carry the customer-facing grade and standard pair the operator expects to read on the order.
            </div>
          </div>
          <div className="mf-guard">
            <div className="mf-guard-kicker">Color-routed demand</div>
            <div className="mf-guard-title">One selected standard, one color pool, one shared stock draw</div>
            <div className="mf-guard-copy">
              All lines in this run are routed through <strong>{standard.colorFamily || '-'}</strong>. That is why a single queue can create both clean fills and late blocked lines inside the same color.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
