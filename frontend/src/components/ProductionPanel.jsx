import React, { useState } from 'react';

const InfoBtn = ({ tip }) => (
  <button className="info-btn">i<span className="info-tip">{tip}</span></button>
);

function ProductionPanel({ recommendation, pigment }) {
  const [expandedSection, setExpandedSection] = useState('overview');

  if (!recommendation) return null;

  const r = recommendation;
  const hasShortage = r.shortage > 0;
  const utilizationPercent = r.totalRequired > 0 
    ? Math.min(100, (r.availableTonnage / r.totalRequired) * 100) 
    : 100;
  
  const getStatusInfo = () => {
    if (!hasShortage) return { label: 'Sufficient Stock', color: 'var(--success)' };
    if (utilizationPercent >= 50) return { label: 'Partial Coverage', color: 'var(--warning)' };
    return { label: 'Low Stock', color: 'var(--danger)' };
  };

  const statusInfo = getStatusInfo();
  const getStatusClass = s => s === 'Full' ? 'full' : s === 'Partial' ? 'partial' : 'none';

  const fullCount = (r.fulfillmentDetails || []).filter(d => d.status === 'Full').length;
  const partialCount = (r.fulfillmentDetails || []).filter(d => d.status === 'Partial').length;
  const noneCount = (r.fulfillmentDetails || []).filter(d => d.status !== 'Full' && d.status !== 'Partial').length;

  const toggleSection = (section) => {
    setExpandedSection(expandedSection === section ? null : section);
  };

  return (
    <div className="production-panel glass">
      <div className="prod-scroll-container">
        {/* Header */}
        <div className="prod-header">
          <div className="prod-header-top">
            <h3 className="prod-title">Production Recommendation</h3>
            <InfoBtn tip="Analysis of inventory levels and production needs based on matched orders" />
          </div>
          {pigment && (
            <div className="prod-pigment-tag">
              <div className="prod-pigment-swatch" style={{ backgroundColor: pigment.hex || '#888' }} />
              <span>{pigment.id}</span>
            </div>
          )}
        </div>

        {/* Status Banner */}
        <div className="prod-status-banner" style={{ '--status-color': statusInfo.color }}>
          <div className="prod-status-indicator" />
          <div className="prod-status-text">
            <div className="prod-status-label">{statusInfo.label}</div>
            <div className="prod-status-summary">{r.summary}</div>
          </div>
        </div>

        {/* Inventory Overview */}
        <div className="prod-section">
          <button 
            className={`prod-section-header ${expandedSection === 'overview' ? 'expanded' : ''}`}
            onClick={() => toggleSection('overview')}
          >
            <span className="prod-section-title">Inventory Overview</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          
          <div className={`prod-section-content ${expandedSection === 'overview' ? 'expanded' : ''}`}>
            {/* Progress Bar */}
            <div className="prod-progress-container">
              <div className="prod-progress-labels">
                <span>Available: {r.availableTonnage?.toFixed(1)}t</span>
                <span>Required: {r.totalRequired?.toFixed(1)}t</span>
              </div>
              <div className="prod-progress-bar">
                <div 
                  className="prod-progress-fill" 
                  style={{ 
                    width: `${utilizationPercent}%`,
                    backgroundColor: statusInfo.color 
                  }} 
                />
              </div>
              <div className="prod-progress-percent">{utilizationPercent.toFixed(0)}% coverage</div>
            </div>

            {/* Key Metrics */}
            <div className="prod-metrics-scroll">
              <div className="prod-metrics">
                <div className="prod-metric">
                  <div className="prod-metric-label">Available</div>
                  <div className="prod-metric-value">{r.availableTonnage?.toFixed(1)}<span>t</span></div>
                </div>

                <div className="prod-metric">
                  <div className="prod-metric-label">Required</div>
                  <div className="prod-metric-value">{r.totalRequired?.toFixed(1)}<span>t</span></div>
                </div>

                {hasShortage && (
                  <>
                    <div className="prod-metric shortage">
                      <div className="prod-metric-label">Shortage</div>
                      <div className="prod-metric-value shortage">{r.shortage?.toFixed(1)}<span>t</span></div>
                    </div>

                    <div className="prod-metric highlight">
                      <div className="prod-metric-label">Recommended</div>
                      <div className="prod-metric-value produce">{r.productionRecommendation?.toFixed(1)}<span>t</span></div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Order Fulfillment */}
        <div className="prod-section">
          <button 
            className={`prod-section-header ${expandedSection === 'fulfillment' ? 'expanded' : ''}`}
            onClick={() => toggleSection('fulfillment')}
          >
            <span className="prod-section-title">Order Fulfillment</span>
            <div className="prod-section-badges">
              {fullCount > 0 && <span className="prod-badge full">{fullCount}</span>}
              {partialCount > 0 && <span className="prod-badge partial">{partialCount}</span>}
              {noneCount > 0 && <span className="prod-badge none">{noneCount}</span>}
            </div>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          
          <div className={`prod-section-content ${expandedSection === 'fulfillment' ? 'expanded' : ''}`}>
            <div className="prod-fulfill-list">
              {(r.fulfillmentDetails || []).map(d => (
                <div key={d.orderId} className={`prod-fulfill-item ${getStatusClass(d.status)}`}>
                  <div className="prod-fulfill-status-dot" />
                  <div className="prod-fulfill-info">
                    <span className="prod-fulfill-order">{d.orderId}</span>
                    {d.tonnage && <span className="prod-fulfill-tonnage">{d.tonnage}t</span>}
                  </div>
                  <span className={`prod-fulfill-status ${getStatusClass(d.status)}`}>{d.status}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Action Items */}
        {r.actionItems?.length > 0 && (
          <div className="prod-section">
            <button 
              className={`prod-section-header ${expandedSection === 'actions' ? 'expanded' : ''}`}
              onClick={() => toggleSection('actions')}
            >
              <span className="prod-section-title">Action Items</span>
              <span className="prod-action-count">{r.actionItems.length}</span>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            
            <div className={`prod-section-content ${expandedSection === 'actions' ? 'expanded' : ''}`}>
              <ul className="prod-action-list">
                {r.actionItems.map((a, i) => (
                  <li key={i} className="prod-action-item">
                    <div className="prod-action-number">{i + 1}</div>
                    <span>{a}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default ProductionPanel;