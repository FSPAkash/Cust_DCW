import React, { useEffect, useRef, useState } from 'react';

const InfoBtn = ({ tip }) => (
  <button className="info-btn">i<span className="info-tip">{tip}</span></button>
);

const fallbackSwatchFromCode = (standardCode = '') => {
  let hash = 0;
  for (let i = 0; i < standardCode.length; i += 1) hash = standardCode.charCodeAt(i) + ((hash << 5) - hash);
  const h = Math.abs(hash) % 360;
  return `hsl(${h}, 45%, 45%)`;
};

const swatchFromStandard = (standard) =>
  standard?.previewHex || fallbackSwatchFromCode(standard?.standardCode || '');

function PigmentSelector({ standards, onSelect, loading, selectedStandard }) {
  const [selId, setSelId] = useState('');
  const [open, setOpen] = useState(false);
  const [comboOpen, setComboOpen] = useState(false);
  const comboRef = useRef(null);

  useEffect(() => {
    if (selectedStandard?.standardCode) setSelId(selectedStandard.standardCode);
  }, [selectedStandard]);

  useEffect(() => {
    if (!comboOpen) return undefined;
    const onDoc = (e) => { if (comboRef.current && !comboRef.current.contains(e.target)) setComboOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setComboOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [comboOpen]);

  const current = standards.find(p => p.standardCode === selId);

  const analyze = () => { if (selId && !loading) onSelect(selId); };
  const chipClick = id => { if (!loading) { setSelId(id); onSelect(id); } };
  const pickStd = (id) => { setSelId(id); setComboOpen(false); };
  const stdLabel = (p) => `${p.standardCode} - Grade ${p.grade} - ${p.inventoryQtyMt?.toFixed(1)}t - ${p.lotCount} lots`;

  return (
    <div className="selector-section glass">
      <div className="selector-header">
        <span className="selector-title">Select Standard</span>
        <InfoBtn tip="Choose the standard currently in production to analyze requirement fulfillability" />
      </div>

      <div className="selector-row">
        <div className="form-group">
          <label className="form-label">Standard <InfoBtn tip="Standard code, grade, lot count, and inventory quantity" /></label>
          <div className="std-combo" ref={comboRef}>
            <button
              type="button"
              className="std-combo-trigger"
              onClick={() => !loading && setComboOpen(o => !o)}
              disabled={loading}
              aria-haspopup="listbox"
              aria-expanded={comboOpen}
            >
              {current ? (
                <>
                  <span className="std-swatch" style={{ backgroundColor: swatchFromStandard(current) }} />
                  <span className="std-combo-label">{stdLabel(current)}</span>
                </>
              ) : (
                <span className="std-combo-label std-combo-placeholder">Select...</span>
              )}
              <svg className="std-combo-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            {comboOpen && (
              <ul className="std-combo-list" role="listbox">
                {standards.map(p => {
                  const selected = selId === p.standardCode;
                  return (
                    <li
                      key={p.standardCode}
                      role="option"
                      aria-selected={selected}
                      className={`std-combo-opt${selected ? ' is-selected' : ''}`}
                      onClick={() => pickStd(p.standardCode)}
                    >
                      <span className="std-swatch" style={{ backgroundColor: swatchFromStandard(p) }} />
                      <span className="std-combo-label">{stdLabel(p)}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
        <button className="btn btn-primary" onClick={analyze} disabled={!selId || loading}>
          {loading ? 'Analyzing...' : 'Lookup Requirements'}
        </button>
      </div>

      {current && (
        <div className="selected-preview">
          <div className="selected-swatch" style={{ backgroundColor: swatchFromStandard(current) }} />
          <div>
            <div className="selected-id">{current.standardCode}</div>
            <div className="selected-meta">Grade: {current.grade}</div>
            <div className="selected-tonnage">{current.inventoryQtyMt?.toFixed(2)}t across {current.lotCount} lots</div>
          </div>
        </div>
      )}

      <button className={`visual-toggle ${open ? 'open' : ''}`} onClick={() => setOpen(!open)}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="6 9 12 15 18 9" />
        </svg>
        Standard selector
        <span className="visual-toggle-count">{standards.length}</span>
      </button>

      <div className={`visual-grid-wrap ${open ? 'open' : ''}`}>
        <div className="visual-grid">
          {standards.map(p => (
            <div
              key={p.standardCode}
              className={`pigment-chip ${selectedStandard?.standardCode === p.standardCode ? 'selected' : ''}`}
              style={{ backgroundColor: swatchFromStandard(p) }}
              onClick={() => chipClick(p.standardCode)}
              data-id={p.standardCode}
              title={`${p.standardCode} (${p.grade})`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export default PigmentSelector;
