import React from 'react';

const InfoBtn = ({ tip }) => (
  <button className="info-btn">i<span className="info-tooltip">{tip}</span></button>
);

const CheckIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>
);
const WarnIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
);
const AlertIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
);

function ProductionRecommendation({ recommendation, pigment }) {
  if (!recommendation) return null;

  const status = recommendation.status || 'success';
  const StatusIcon = status === 'success' ? CheckIcon : status === 'warning' ? WarnIcon : AlertIcon;

  const getPillClass = (s) => s === 'Full' ? 'full' : s === 'Partial' ? 'partial' : 'none';

  return (
    <div className="production-card glass-card">
      <div className="production-header">
        <div className="production-header-left">
          <div className={`status-icon ${status}`}><StatusIcon /></div>
          <div>
            <div className="production-title">
              Production Recommendation
              <InfoBtn tip="Analysis of inventory vs. order requirements" />
            </div>
            <div className="production-subtitle">Pigment {pigment?.id}</div>
          </div>
        </div>
        <span className={`status-tag ${status}`}>{status}</span>
      </div>

      <div className="production-body">
        <p className="production-summary">{recommendation.summary}</p>

        <div className="inventory-stats">
          <div className="inventory-stat">
            <div className="inventory-stat-label">Available</div>
            <div className="inventory-stat-value">{recommendation.availableTonnage?.toFixed(2)}<span className="inventory-stat-unit"> t</span></div>
          </div>
          <div className="inventory-stat">
            <div className="inventory-stat-label">Required</div>
            <div className="inventory-stat-value">{recommendation.totalRequired?.toFixed(2)}<span className="inventory-stat-unit"> t</span></div>
          </div>
          <div className="inventory-stat">
            <div className="inventory-stat-label">Shortage</div>
            <div className={`inventory-stat-value ${recommendation.shortage > 0 ? 'shortage' : 'surplus'}`}>
              {recommendation.shortage?.toFixed(2)}<span className="inventory-stat-unit"> t</span>
            </div>
          </div>
          {recommendation.productionRecommendation > 0 && (
            <div className="inventory-stat highlight">
              <div className="inventory-stat-label">Produce</div>
              <div className="inventory-stat-value produce">{recommendation.productionRecommendation?.toFixed(2)}<span className="inventory-stat-unit"> t</span></div>
            </div>
          )}
        </div>

        <div className="fulfillment-section">
          <h3>Order Fulfillment <InfoBtn tip="How much of each order can be fulfilled with current inventory" /></h3>
          <table className="fulfillment-table">
            <thead>
              <tr><th>Order</th><th>Customer</th><th>Required</th><th>Fulfillable</th><th>Status</th><th>Progress</th></tr>
            </thead>
            <tbody>
              {(recommendation.fulfillmentDetails || []).map(d => (
                <tr key={d.orderId}>
                  <td style={{fontWeight:600}}>{d.orderId}</td>
                  <td>{d.customerName}</td>
                  <td>{d.required?.toFixed(2)} t</td>
                  <td>{d.canFulfill?.toFixed(2)} t</td>
                  <td><span className={`status-pill ${getPillClass(d.status)}`}>{d.status}</span></td>
                  <td>
                    <div className="progress-cell">
                      <div className="progress-bar"><div className="progress-fill" style={{width:`${d.fulfillmentPercentage||0}%`}}/></div>
                      <span className="progress-text">{d.fulfillmentPercentage?.toFixed(0)}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="action-section">
          <h3>Recommended Actions <InfoBtn tip="Suggested next steps based on inventory analysis" /></h3>
          <ul className="action-list">
            {(recommendation.actionItems || []).map((item, i) => <li key={i}>{item}</li>)}
          </ul>
        </div>

        {recommendation.highPriorityRequired > 0 && (
          <div className="priority-alert">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
            <p>High-priority orders need <strong>{recommendation.highPriorityRequired?.toFixed(2)} tonnes</strong>.</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default ProductionRecommendation;