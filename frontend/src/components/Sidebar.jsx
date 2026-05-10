import React, { useState } from 'react';

const BellIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
  </svg>
);

function Sidebar({
  user,
  onLogout,
  standardCount,
  lotCount,
  requirementLineCount,
  unsupportedLineCount,
  mode,
  onModeChange,
  notifications,
  onNotificationClick,
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const notifCount = notifications?.length || 0;

  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      <button
        className="sidebar-toggle"
        onClick={() => setCollapsed(!collapsed)}
        type="button"
        title={collapsed ? 'Expand' : 'Collapse'}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points={collapsed ? '9 18 15 12 9 6' : '15 18 9 12 15 6'} />
        </svg>
      </button>

      <div className="sidebar-header">
        <div className="sidebar-avatar">{user.name?.[0] || '?'}</div>
        {!collapsed && (
          <>
            <div className="sidebar-header-text">
              <div className="sidebar-welcome">{user.name}</div>
              <div className="sidebar-role">{user.type}</div>
            </div>
            <button className="btn btn-sm btn-ghost" onClick={onLogout} type="button">Sign out</button>
          </>
        )}
      </div>

      {!collapsed && (
        <>
          <div className="sidebar-section">
            <div className="sidebar-section-title"><span>Mode</span></div>
            <div className="mode-toggle">
              <button
                className={mode === 'simulate' ? 'active' : ''}
                onClick={() => onModeChange('simulate')}
                type="button"
              >
                Simulate
              </button>
              <button
                className={mode === 'commit' ? 'active' : ''}
                onClick={() => onModeChange('commit')}
                type="button"
              >
                Commit
              </button>
            </div>
            <div className="mode-hint">
              {mode === 'simulate'
                ? 'Try fulfillment plans without changing data.'
                : 'Locking will write to the inventory and audit log.'}
            </div>
          </div>

          <div className="sidebar-section">
            <div className="sidebar-section-title"><span>Carried over</span></div>
            <div className="notif-wrap">
              <button className="notif-bell" onClick={() => setNotifOpen(!notifOpen)} type="button">
                <BellIcon />
                <span>Partial fulfillments</span>
                <span className={`notif-count ${notifCount === 0 ? 'zero' : ''}`}>{notifCount}</span>
              </button>
              {notifOpen && (
                <div className="notif-panel">
                  {notifCount === 0 ? (
                    <div className="notif-panel-empty">No partial fulfillments outstanding.</div>
                  ) : (
                    notifications.map(n => (
                      <div
                        className="notif-item"
                        key={n.invoiceLineId}
                        onClick={() => { onNotificationClick?.(n); setNotifOpen(false); }}
                      >
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
          </div>

          <div className="sidebar-section">
            <div className="sidebar-section-title"><span>Database</span></div>
            <div className="sidebar-stat"><span className="stat-label">Standards</span><span className="stat-value">{standardCount}</span></div>
            <div className="sidebar-stat"><span className="stat-label">Lots</span><span className="stat-value">{lotCount}</span></div>
            <div className="sidebar-stat"><span className="stat-label">Requirement lines</span><span className="stat-value">{requirementLineCount}</span></div>
            <div className="sidebar-stat"><span className="stat-label">Unsupported</span><span className="stat-value">{unsupportedLineCount}</span></div>
          </div>
        </>
      )}
    </aside>
  );
}

export default Sidebar;
