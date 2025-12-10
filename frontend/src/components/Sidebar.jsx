import React, { useRef, useState } from 'react';
import config from '../config';

const InfoBtn = ({ tip }) => (
  <button className="info-btn">i<span className="info-tip">{tip}</span></button>
);

function Sidebar({ user, onLogout, pigmentCount, orderCount, onDatabaseUpdate }) {
  const [msg, setMsg] = useState(null);
  const [collapsed, setCollapsed] = useState(false);
  const pRef = useRef(), oRef = useRef();

  const upload = async (type, file) => {
    if (!file) return;
    setMsg(null);
    const fd = new FormData();
    fd.append('file', file);
    try {
      const res = await fetch(`${config.API_URL}/api/database/upload/${type}`, { 
        method: 'POST', 
        body: fd 
      });
      const d = await res.json();
      setMsg(d.success ? { t: 'success', m: `${d.count} loaded` } : { t: 'error', m: d.message });
      if (d.success) onDatabaseUpdate();
    } catch {
      setMsg({ t: 'error', m: 'Failed' });
    }
    if (pRef.current) pRef.current.value = '';
    if (oRef.current) oRef.current.value = '';
  };

  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      <button 
        className="sidebar-toggle" 
        onClick={() => setCollapsed(!collapsed)}
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points={collapsed ? "9 18 15 12 9 6" : "15 18 9 12 15 6"} />
        </svg>
      </button>

      <div className="sidebar-header">
        <div className="sidebar-avatar" title={collapsed ? user.name : ''}>
          {user.name[0]}
        </div>
        {!collapsed && (
          <>
            <div className="sidebar-header-text">
              <div className="sidebar-welcome">Welcome, {user.name}</div>
              <div className="sidebar-role">{user.type}</div>
            </div>
            <button className="btn btn-secondary btn-sm" onClick={onLogout}>
              Sign Out
            </button>
          </>
        )}
      </div>

      {!collapsed && (
        <div className="sidebar-content">
          <div className="sidebar-section">
            <div className="sidebar-section-title">
              <span>Database</span>
              <InfoBtn tip="Loaded records" />
            </div>
            <div className="sidebar-stat">
              <span className="stat-label">Pigments</span>
              <span className="stat-value">{pigmentCount}</span>
            </div>
            <div className="sidebar-stat">
              <span className="stat-label">Orders</span>
              <span className="stat-value">{orderCount}</span>
            </div>
          </div>

          <div className="sidebar-section">
            <div className="sidebar-section-title">
              <span>Upload</span>
              <InfoBtn tip="Excel files with L,a,b columns" />
            </div>
            <div className="upload-item">
              <label>Pigments</label>
              <input 
                type="file" 
                ref={pRef} 
                accept=".xlsx,.xls" 
                onChange={e => upload('pigments', e.target.files[0])} 
              />
            </div>
            <div className="upload-item">
              <label>Orders</label>
              <input 
                type="file" 
                ref={oRef} 
                accept=".xlsx,.xls" 
                onChange={e => upload('orders', e.target.files[0])} 
              />
            </div>
            {msg && (
              <div 
                className={`alert alert-${msg.t}`} 
                style={{ marginTop: 4, padding: 4, fontSize: '0.65rem' }}
              >
                {msg.m}
              </div>
            )}
          </div>
        </div>
      )}
    </aside>
  );
}

export default Sidebar;