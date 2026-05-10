export const DEFAULT_DE_THRESHOLD = 1.0;

const PERCEPT_ORDER = { imperceptible: 0, slight: 1, noticeable: 2, distinct: 3, obvious: 4, unknown: 5 };
const perceptRank = (c) => PERCEPT_ORDER[c?.perceptual?.key] ?? 5;

const rankBy = (items, key, higherBetter = false) => {
  const valued = items
    .map((it, idx) => ({ idx, v: it[key] }))
    .filter(({ v }) => Number.isFinite(v));
  valued.sort((a, b) => (higherBetter ? b.v - a.v : a.v - b.v));
  const ranks = new Array(items.length).fill(null);
  valued.forEach(({ idx }, i) => { ranks[idx] = i + 1; });
  return ranks;
};

// Mirror backend model_score_and_rank consensus formula on a filtered candidate set.
export const recomputeConsensus = (candidates) => {
  if (!candidates.length) return [];
  const items = candidates.map(c => ({ ...c }));
  const eRanks = rankBy(items, 'euclideanDeltaE', false);
  const cRanks = rankBy(items, 'cosineSimilarity', true);
  const kRanks = rankBy(items, 'knnDistance', false);
  const total = items.length;
  items.forEach((cand, i) => {
    const eR = eRanks[i] ?? total;
    const cR = cRanks[i] ?? total;
    const kR = kRanks[i] ?? total;
    cand.dynamicEuclideanRank = eR;
    cand.dynamicCosineRank = cR;
    cand.dynamicKnnRank = kR;
    const pE = total - eR + 1;
    const pC = total - cR + 1;
    const pK = total - kR + 1;
    cand.dynamicConsensusScore = Number((((pE + pC + pK) / (3 * total)) * 100).toFixed(3));
  });
  items.sort((a, b) => {
    if (b.dynamicConsensusScore !== a.dynamicConsensusScore) return b.dynamicConsensusScore - a.dynamicConsensusScore;
    if ((a.dynamicEuclideanRank ?? 9999) !== (b.dynamicEuclideanRank ?? 9999)) return (a.dynamicEuclideanRank ?? 9999) - (b.dynamicEuclideanRank ?? 9999);
    if ((b.availableQtyMt || 0) !== (a.availableQtyMt || 0)) return (b.availableQtyMt || 0) - (a.availableQtyMt || 0);
    return (a.lotNo || '').localeCompare(b.lotNo || '');
  });
  items.forEach((cand, i) => { cand.dynamicConsensusRank = i + 1; });
  return items;
};

// At default threshold (1.0): preserve original allocation semantics
// (isEligibleForTolerance + perceptual rank <= slight). When the user
// widens the threshold, the slider acts as an explicit tolerance override
// and the dE bound alone gates the candidate set.
export const filterCandidatesByThreshold = (candidates, threshold) => {
  const t = Number.isFinite(threshold) ? threshold : DEFAULT_DE_THRESHOLD;
  const isDefault = Math.abs(t - DEFAULT_DE_THRESHOLD) <= 1e-9;
  return (candidates || []).filter(c => {
    if (!Number.isFinite(c.euclideanDeltaE)) return false;
    if (c.euclideanDeltaE > t + 1e-9) return false;
    const qty = Number.isFinite(c.simulatedAvailableQtyMt) ? c.simulatedAvailableQtyMt : (c.availableQtyMt || 0);
    if (qty <= 1e-9) return false;
    if (isDefault) {
      return Boolean(c.isEligibleForTolerance) && perceptRank(c) <= 1;
    }
    return true;
  });
};
