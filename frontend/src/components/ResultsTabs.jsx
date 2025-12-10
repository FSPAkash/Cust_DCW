import React, { useState } from 'react';
import Visualization3D from './Visualization3D';

const InfoBtn = ({ tip }) => (
  <button className="info-btn">i<span className="info-tip">{tip}</span></button>
);

const getDeltaEInterpretation = (deltaE) => {
  if (deltaE === null || deltaE === undefined) return null;
  if (deltaE < 1) return { label: 'Imperceptible', color: '#34c759' };
  if (deltaE < 2) return { label: 'Very Slight', color: '#30d158' };
  if (deltaE < 3.5) return { label: 'Noticeable', color: '#ff9500' };
  if (deltaE < 5) return { label: 'Significant', color: '#ff3b30' };
  return { label: 'Large', color: '#ff3b30' };
};

const TonnageIcon = () => (
  <svg className="tonnage-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
  </svg>
);

const getMethodMetric = (order) => {
  // Determine which method ranked this order highest and return that metric
  const ranks = {
    euclidean: order.euclideanRank || 999,
    cosine: order.cosineRank || 999,
    knn: order.knnRank || 999
  };

  const bestMethod = Object.keys(ranks).reduce((a, b) => ranks[a] < ranks[b] ? a : b);

  switch (bestMethod) {
    case 'euclidean':
      return {
        method: 'Euclidean',
        value: order.euclideanDeltaE?.toFixed(2) || order.deltaE?.toFixed(2) || '-',
        unit: 'dE',
        rank: order.euclideanRank
      };
    case 'cosine':
      return {
        method: 'Cosine',
        value: order.cosineSimilarity?.toFixed(4) || order.similarity?.toFixed(4) || '-',
        unit: 'sim',
        rank: order.cosineRank
      };
    case 'knn':
      return {
        method: 'KNN',
        value: order.knnDistance?.toFixed(3) || order.distance?.toFixed(3) || '-',
        unit: 'dist',
        rank: order.knnRank
      };
    default:
      return {
        method: 'Match',
        value: order.matchPercentage?.toFixed(0) || '-',
        unit: '%',
        rank: null
      };
  }
};

function OrderCard({ order, rank, tab }) {
  const [isExpanded, setIsExpanded] = useState(false);
  
  const getRankClass = (r) => {
    if (r === 1) return 'r1';
    if (r === 2) return 'r2';
    if (r === 3) return 'r3';
    return 'r-default';
  };

  const getMetricDisplay = () => {
    switch (tab) {
      case 'euclidean':
        return { value: order.deltaE?.toFixed(2), label: 'Delta E', unit: 'dE' };
      case 'cosine':
        return { value: order.similarity?.toFixed(4), label: 'Similarity', unit: '' };
      case 'knn':
        return { value: order.distance?.toFixed(3), label: 'Distance', unit: '' };
      case 'consensus':
      default:
        const methodMetric = getMethodMetric(order);
        return { 
          value: methodMetric.value, 
          label: methodMetric.method, 
          unit: methodMetric.unit 
        };
    }
  };

  const metric = getMetricDisplay();
  const interpretation = getDeltaEInterpretation(
    tab === 'consensus' ? order.euclideanDeltaE : (tab === 'euclidean' ? order.deltaE : null)
  );

  return (
    <div className={`order-card ${isExpanded ? 'expanded' : ''}`}>
      <div className="order-header" onClick={() => setIsExpanded(!isExpanded)}>
        <div className={`order-rank ${getRankClass(rank)}`}>{rank}</div>
        <div className="order-swatch" style={{ backgroundColor: order.hexColor || '#888' }} />
        <div className="order-info">
          <div className="order-id-row">
            <span className="order-id">{order.orderId}</span>
            {order.priority && <span className="priority-badge">{order.priority}</span>}
          </div>
          <div className="order-customer">{order.customerName}</div>
        </div>
        <div className="order-metric">
          <div className="order-metric-value">
            {metric.value}
            {metric.unit && <span className="order-metric-unit">{metric.unit}</span>}
          </div>
          <div className="order-metric-label">{metric.label}</div>
        </div>
        <div className={`expand-icon ${isExpanded ? 'expanded' : ''}`}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>
      </div>
      
      <div className={`order-body ${isExpanded ? 'expanded' : ''}`}>
        <div className="order-body-content">
          <div className="order-lab-display">
            <div className="lab-chip l-chip">
              <div className="lab-chip-label">L*</div>
              <div className="lab-chip-value">{order.L?.toFixed(1)}</div>
            </div>
            <div className="lab-chip a-chip">
              <div className="lab-chip-label">a*</div>
              <div className="lab-chip-value">{order.a?.toFixed(1)}</div>
            </div>
            <div className="lab-chip b-chip">
              <div className="lab-chip-label">b*</div>
              <div className="lab-chip-value">{order.b?.toFixed(1)}</div>
            </div>
          </div>

          {tab === 'euclidean' && interpretation && (
            <div className="order-interpretation">
              <div className="interp-indicator" style={{ backgroundColor: interpretation.color }} />
              <span className="interp-text">{interpretation.label} difference</span>
            </div>
          )}

          {tab === 'consensus' && (
            <>
              {interpretation && (
                <div className="order-interpretation">
                  <div className="interp-indicator" style={{ backgroundColor: interpretation.color }} />
                  <span className="interp-text">{interpretation.label} difference</span>
                </div>
              )}
              <div className="method-ranks">
                <div className={`method-rank-chip ${order.euclideanRank ? 'active' : ''}`}>
                  <span>Euclidean</span>
                  #{order.euclideanRank || '-'}
                </div>
                <div className={`method-rank-chip ${order.cosineRank ? 'active' : ''}`}>
                  <span>Cosine</span>
                  #{order.cosineRank || '-'}
                </div>
                <div className={`method-rank-chip ${order.knnRank ? 'active' : ''}`}>
                  <span>KNN</span>
                  #{order.knnRank || '-'}
                </div>
              </div>
            </>
          )}

          <div className="order-tonnage-bar">
            <TonnageIcon />
            <div className="tonnage-info">
              <div className="tonnage-label">Required Tonnage</div>
              <div className="tonnage-value">{order.requiredTonnage?.toFixed(2)} t</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TopMatchCard({ order, rank }) {
  const interpretation = getDeltaEInterpretation(order.euclideanDeltaE);
  const methodMetric = getMethodMetric(order);

  const getMedalColor = (r) => {
    if (r === 1) return 'linear-gradient(135deg, #FFD700, #FFA500)';
    if (r === 2) return 'linear-gradient(135deg, #C0C0C0, #A8A8A8)';
    return 'linear-gradient(135deg, #CD7F32, #8B4513)';
  };

  return (
    <div className="top-match-card">
      <div className="top-match-rank" style={{ background: getMedalColor(rank) }}>
        {rank}
      </div>
      <div className="top-match-swatch" style={{ backgroundColor: order.hexColor || '#888' }} />
      <div className="top-match-content">
        <div className="top-match-header">
          <span className="top-match-id">{order.orderId}</span>
          {order.priority && <span className="priority-badge">{order.priority}</span>}
        </div>
        <div className="top-match-customer">{order.customerName}</div>
        <div className="top-match-lab">
          L:{order.L?.toFixed(1)} a:{order.a?.toFixed(1)} b:{order.b?.toFixed(1)}
        </div>
      </div>
      <div className="top-match-metrics">
        <div className="top-match-metric-primary">
          <span className="top-match-metric-value">{methodMetric.value}</span>
          <span className="top-match-metric-unit">{methodMetric.unit}</span>
        </div>
        <div className="top-match-metric-method">{methodMetric.method}</div>
        {interpretation && (
          <div className="top-match-interp" style={{ backgroundColor: interpretation.color }}>
            {interpretation.label}
          </div>
        )}
      </div>
      <div className="top-match-ranks">
        <div className={`top-match-rank-item ${order.euclideanRank <= 3 ? 'top' : ''}`}>
          <span className="rank-method">E</span>
          <span className="rank-value">#{order.euclideanRank || '-'}</span>
        </div>
        <div className={`top-match-rank-item ${order.cosineRank <= 3 ? 'top' : ''}`}>
          <span className="rank-method">C</span>
          <span className="rank-value">#{order.cosineRank || '-'}</span>
        </div>
        <div className={`top-match-rank-item ${order.knnRank <= 3 ? 'top' : ''}`}>
          <span className="rank-method">K</span>
          <span className="rank-value">#{order.knnRank || '-'}</span>
        </div>
      </div>
      <div className="top-match-tonnage">
        <span className="top-match-tonnage-value">{order.requiredTonnage?.toFixed(1)}</span>
        <span className="top-match-tonnage-unit">t</span>
      </div>
    </div>
  );
}

function ResultsTabs({ results, pigment, orders }) {
  const [tab, setTab] = useState('consensus');
  const [showViz, setShowViz] = useState(false);

  const tabs = [
    { id: 'consensus', label: 'Consensus' },
    { id: 'euclidean', label: 'Euclidean' },
    { id: 'cosine', label: 'Cosine' },
    { id: 'knn', label: 'KNN' }
  ];

  const descs = {
    consensus: 'Orders ranked by combined agreement across all matching methods.',
    euclidean: 'Delta E measures perceptual color difference in LAB space.',
    cosine: 'Angular similarity between color vectors.',
    knn: 'K-Nearest Neighbors with normalized color distances.'
  };

  const refs = {
    euclidean: [
      { r: '<1', m: 'Imperceptible', c: '#34c759' },
      { r: '1-2', m: 'Slight', c: '#30d158' },
      { r: '2-3.5', m: 'Noticeable', c: '#ff9500' },
      { r: '>3.5', m: 'Significant', c: '#ff3b30' }
    ],
    cosine: [
      { r: '>0.99', m: 'Excellent', c: '#34c759' },
      { r: '0.95-0.99', m: 'Good', c: '#30d158' },
      { r: '<0.95', m: 'Moderate', c: '#ff9500' }
    ],
    knn: [
      { r: '<0.5', m: 'Excellent', c: '#34c759' },
      { r: '0.5-1', m: 'Good', c: '#30d158' },
      { r: '>1', m: 'Moderate', c: '#ff9500' }
    ]
  };

  const getData = () => {
    switch (tab) {
      case 'euclidean': return results.euclidean || [];
      case 'cosine': return results.cosine || [];
      case 'knn': return results.knn || [];
      default: return results.consensus || [];
    }
  };

  const data = getData();
  const inputLab = pigment ? { L: pigment.L, a: pigment.a, b: pigment.b } : null;
  
  // For consensus tab, split into top 3 and others
  const topThree = tab === 'consensus' ? data.slice(0, 3) : [];
  const otherMatches = tab === 'consensus' ? data.slice(3) : [];

  return (
    <div className="tabs-panel glass">
      <div className="tabs-nav">
        {tabs.map(t => (
          <button 
            key={t.id} 
            className={`tab-btn ${tab === t.id ? 'active' : ''}`} 
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="tab-panel">
        <p className="tab-intro">{descs[tab]}</p>

        {/* Consensus Tab - Top 3 + Others */}
        {tab === 'consensus' && (
          <>
            {topThree.length > 0 && (
              <div className="top-matches-section">
                <div className="top-matches-header">
                  <h4>Top Matches</h4>
                  <InfoBtn tip="Best matches ranked by consensus across Euclidean, Cosine, and KNN methods" />
                </div>
                <div className="top-matches-grid">
                  {topThree.map((order, i) => (
                    <TopMatchCard key={order.orderId} order={order} rank={i + 1} />
                  ))}
                </div>
              </div>
            )}

            {otherMatches.length > 0 && (
              <div className="orders-section">
                <div className="orders-section-header">
                  <h4>
                    Other Matches
                    <InfoBtn tip="Additional matching orders beyond top 3" />
                  </h4>
                  <span className="orders-count-badge">{otherMatches.length} more</span>
                </div>
                <div className="orders-grid">
                  {otherMatches.map((o, i) => (
                    <OrderCard 
                      key={o.orderId} 
                      order={o} 
                      rank={i + 4} 
                      tab={tab} 
                    />
                  ))}
                </div>
              </div>
            )}

            {data.length === 0 && (
              <div className="empty-state">No matches found for the selected pigment</div>
            )}
          </>
        )}

        {/* Other Tabs - Euclidean, Cosine, KNN */}
        {tab !== 'consensus' && (
          <>
            {refs[tab] && (
              <div className="ref-section">
                <h4>Reference Guide <InfoBtn tip="Interpretation guide for color difference values" /></h4>
                <div className="ref-guide">
                  {refs[tab].map(x => (
                    <div key={x.r} className="ref-item" style={{ backgroundColor: x.c }}>
                      <div className="ref-range">{x.r}</div>
                      <div className="ref-meaning">{x.m}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="orders-section">
              <div className="orders-section-header">
                <h4>
                  Matched Orders
                  <InfoBtn tip="Click any card to expand and view detailed color information" />
                </h4>
                <span className="orders-count-badge">{data.length} results</span>
              </div>
              
              {data.length > 0 ? (
                <div className="orders-grid">
                  {data.map((o, i) => (
                    <OrderCard 
                      key={o.orderId} 
                      order={o} 
                      rank={o.rank || i + 1} 
                      tab={tab} 
                    />
                  ))}
                </div>
              ) : (
                <div className="empty-state">No matches found for the selected pigment</div>
              )}
            </div>

            {/* 3D Visualization */}
            <div className="viz-section">
              <button 
                className={`viz-toggle ${showViz ? 'open' : ''}`}
                onClick={() => setShowViz(!showViz)}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 2L2 7l10 5 10-5-10-5z" />
                  <path d="M2 17l10 5 10-5" />
                  <path d="M2 12l10 5 10-5" />
                </svg>
                <span>3D Color Space Visualization</span>
                <svg className="viz-toggle-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
              
              <div className={`viz-container-wrap ${showViz ? 'open' : ''}`}>
                <div className="viz-container">
                  <Visualization3D
                    database={orders}
                    inputLab={inputLab}
                    inputHex={pigment?.hex}
                    matches={data}
                    methodName={tab.charAt(0).toUpperCase() + tab.slice(1) + ' Distance'}
                  />
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default ResultsTabs;