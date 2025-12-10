import React, { useState } from 'react';

const InfoBtn = ({ tip }) => (
  <button className="info-btn">i<span className="info-tip">{tip}</span></button>
);

function PigmentSelector({ pigments, onSelect, loading, selectedPigment }) {
  const [selId, setSelId] = useState('');
  const [open, setOpen] = useState(false);

  const current = pigments.find(p => p.PigmentID === selId);

  const analyze = () => { if (selId && !loading) onSelect(selId); };
  const chipClick = id => { if (!loading) { setSelId(id); onSelect(id); } };

  return (
    <div className="selector-section glass">
      <div className="selector-header">
        <span className="selector-title">Select Pigment</span>
        <InfoBtn tip="Choose a pigment to find matching orders based on L*a*b* color" />
      </div>

      <div className="selector-row">
        <div className="form-group">
          <label className="form-label">Pigment <InfoBtn tip="ID, L*a*b*, tonnage" /></label>
          <select className="form-select" value={selId} onChange={e => setSelId(e.target.value)} disabled={loading}>
            <option value="">Select...</option>
            {pigments.map(p => (
              <option key={p.PigmentID} value={p.PigmentID}>
                {p.PigmentID} — L:{p.L?.toFixed(1)} a:{p.a?.toFixed(1)} b:{p.b?.toFixed(1)} — {p.AvailableTonnage?.toFixed(1)}t
              </option>
            ))}
          </select>
        </div>
        <button className="btn btn-primary" onClick={analyze} disabled={!selId || loading}>
          {loading ? 'Analyzing...' : 'Find Matches'}
        </button>
      </div>

      {current && (
        <div className="selected-preview">
          <div className="selected-swatch" style={{ backgroundColor: current.HexColor || '#888' }} />
          <div>
            <div className="selected-id">{current.PigmentID}</div>
            <div className="selected-meta">L:{current.L?.toFixed(2)} a:{current.a?.toFixed(2)} b:{current.b?.toFixed(2)}</div>
            <div className="selected-tonnage">{current.AvailableTonnage?.toFixed(2)}t available</div>
          </div>
        </div>
      )}

      <button className={`visual-toggle ${open ? 'open' : ''}`} onClick={() => setOpen(!open)}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="6 9 12 15 18 9" />
        </svg>
        Visual selector
        <span className="visual-toggle-count">{pigments.length}</span>
      </button>

      <div className={`visual-grid-wrap ${open ? 'open' : ''}`}>
        <div className="visual-grid">
          {pigments.map(p => (
            <div 
              key={p.PigmentID} 
              className={`pigment-chip ${selectedPigment?.id === p.PigmentID ? 'selected' : ''}`} 
              style={{ backgroundColor: p.HexColor || '#888' }} 
              onClick={() => chipClick(p.PigmentID)}
              data-id={p.PigmentID}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export default PigmentSelector;