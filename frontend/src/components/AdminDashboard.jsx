// components/AdminDashboard.jsx

import React, { useState, useEffect, useCallback } from 'react';
import { adminApi } from '../utils/adminApi.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const STATE_META = {
  CREATED:        { label: 'Created',        color: '#7A7A8C', bg: 'rgba(122,122,140,0.12)' },
  CARD_PENDING:   { label: 'Card Pending',   color: '#C9A84C', bg: 'rgba(201,168,76,0.12)'  },
  CARD_SUCCESS:   { label: 'Card Success',   color: '#4A90D9', bg: 'rgba(74,144,217,0.12)'  },
  CARD_FAILED:    { label: 'Card Failed',    color: '#E05050', bg: 'rgba(224,80,80,0.12)'   },
  UPI_PENDING:    { label: 'Netbanking Pending',    color: '#C9A84C', bg: 'rgba(201,168,76,0.12)'  },
  UPI_FAILED:     { label: 'Netbanking Failed',     color: '#E05050', bg: 'rgba(224,80,80,0.12)'   },
  COMPLETED:      { label: 'Completed',      color: '#2ECC8F', bg: 'rgba(46,204,143,0.12)'  },
  CANCELLED:      { label: 'Cancelled',      color: '#7A7A8C', bg: 'rgba(122,122,140,0.12)' },
  REFUND_FLAGGED: { label: 'Refund Flagged', color: '#E08850', bg: 'rgba(224,136,80,0.12)'  },
};

function StateBadge({ state }) {
  const meta = STATE_META[state] || { label: state, color: '#7A7A8C', bg: 'rgba(122,122,140,0.1)' };
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '3px 8px', borderRadius: 20,
      fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 500,
      color: meta.color, background: meta.bg,
      border: `1px solid ${meta.color}30`,
      whiteSpace: 'nowrap',
    }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: meta.color, flexShrink: 0 }} />
      {meta.label}
    </span>
  );
}

function fmt(n) {
  if (n == null) return '—';
  return '₹' + Number(n).toLocaleString('en-IN');
}

function timeAgo(iso) {
  if (!iso) return '—';
  const diff = Math.round((Date.now() - new Date(iso)) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return new Date(iso).toLocaleDateString('en-IN');
}

// ─── Stats Strip ─────────────────────────────────────────────────────────────

function StatsStrip({ stats, onSweep, sweeping }) {
  return (
    <div className="stats-strip">
      <div className="stat-card">
        <span className="stat-val">{stats.total}</span>
        <span className="stat-lbl">Total Sessions</span>
      </div>
      <div className="stat-card success">
        <span className="stat-val">{stats.completed}</span>
        <span className="stat-lbl">Completed</span>
      </div>
      <div className="stat-card warn">
        <span className="stat-val">{stats.pending}</span>
        <span className="stat-lbl">Pending</span>
      </div>
      <div className="stat-card danger">
        <span className="stat-val">{stats.refundFlagged}</span>
        <span className="stat-lbl">Needs Refund</span>
      </div>
      <div className="stat-card revenue">
        <span className="stat-val revenue-val">{fmt(stats.totalRevenue)}</span>
        <span className="stat-lbl">Revenue Confirmed</span>
      </div>
      <button className="sweep-btn" onClick={onSweep} disabled={sweeping}>
        {sweeping ? '⟳ Sweeping…' : '⟳ Run Sweep'}
      </button>
    </div>
  );
}

// ─── Session Row ──────────────────────────────────────────────────────────────

function SessionRow({ session, onSelect, selected }) {
  return (
    <tr
      className={`session-row ${selected ? 'selected' : ''}`}
      onClick={() => onSelect(session)}
    >
      <td className="mono" style={{ fontSize: 11, color: 'var(--muted)', maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {session.sessionId.slice(0, 8)}…
      </td>
      <td><StateBadge state={session.state} /></td>
      <td className="mono" style={{ color: 'var(--smoke)' }}>{fmt(session.orderTotal)}</td>
      <td className="mono" style={{ color: '#C9A84C', fontSize: 12 }}>{fmt(session.cardAmount)}</td>
      <td className="mono" style={{ color: '#4A90D9', fontSize: 12 }}>{fmt(session.upiAmount)}</td>
      <td style={{ fontSize: 12, color: 'var(--muted)' }}>{timeAgo(session.createdAt)}</td>
      <td>
        {session.state === 'REFUND_FLAGGED' && !session.refundId && (
          <span className="needs-refund-badge">Refund needed</span>
        )}
        {session.refundId && (
          <span className="refund-done-badge">Refunded</span>
        )}
      </td>
    </tr>
  );
}

// ─── Session Detail Panel ─────────────────────────────────────────────────────

function SessionDetail({ session, onRefund, onDelete, onClose, loading }) {
  const [reason, setReason] = useState('UPI leg failed — manual refund');
  const [refundStatus, setRefundStatus] = useState(null);
  const [syncingRefund, setSyncingRefund] = useState(false);

  async function syncRefund() {
    setSyncingRefund(true);
    try {
      const res = await adminApi.getRefundStatus(session.sessionId);
      setRefundStatus(res);
    } catch (e) {
      setRefundStatus({ error: e.message });
    }
    setSyncingRefund(false);
  }

  const canRefund = session.cardPaymentId &&
    session.state === 'REFUND_FLAGGED' &&
    !session.refundId;

  return (
    <div className="detail-panel">
      <div className="detail-header">
        <div>
          <div className="detail-id mono">{session.sessionId}</div>
          <StateBadge state={session.state} />
        </div>
        <button className="close-btn" onClick={onClose}>✕</button>
      </div>

      {/* Amounts */}
      <div className="detail-amounts">
        <div className="amount-row">
          <span className="amount-lbl">Order Total</span>
          <span className="amount-val">{fmt(session.orderTotal)}</span>
        </div>
        <div className="amount-row">
          <span className="amount-lbl" style={{ color: '#C9A84C' }}>Card</span>
          <span className="amount-val mono" style={{ color: '#C9A84C' }}>{fmt(session.cardAmount)}</span>
        </div>
        <div className="amount-row">
          <span className="amount-lbl" style={{ color: '#4A90D9' }}>Netbanking</span>
          <span className="amount-val mono" style={{ color: '#4A90D9' }}>{fmt(session.upiAmount)}</span>
        </div>
      </div>

      {/* Payment IDs */}
      <div className="detail-section">
        <div className="detail-section-title">Payment IDs</div>
        <div className="id-grid">
          <span className="id-lbl">Card Order</span>
          <span className="id-val mono">{session.cardOrderId || '—'}</span>
          <span className="id-lbl">Card Payment</span>
          <span className="id-val mono">{session.cardPaymentId || '—'}</span>
          <span className="id-lbl">Netbanking Order</span>
          <span className="id-val mono">{session.upiOrderId || '—'}</span>
          <span className="id-lbl">Netbanking Payment</span>
          <span className="id-val mono">{session.upiPaymentId || '—'}</span>
          {session.refundId && <>
            <span className="id-lbl" style={{ color: '#E08850' }}>Refund ID</span>
            <span className="id-val mono" style={{ color: '#E08850' }}>{session.refundId}</span>
            <span className="id-lbl">Refund Status</span>
            <span className="id-val mono">{session.refundStatus || '—'}</span>
          </>}
        </div>
      </div>

      {/* Activity log */}
      <div className="detail-section">
        <div className="detail-section-title">Activity Log</div>
        <div className="log-list">
          {(session.logs || []).map((log, i) => (
            <div key={i} className="log-entry">
              <span className="log-dot" />
              <span className="log-text">{log}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Refund action */}
      {canRefund && (
        <div className="detail-section refund-action">
          <div className="detail-section-title" style={{ color: '#E08850' }}>Trigger Refund</div>
          <input
            className="reason-input"
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="Refund reason"
          />
          <button
            className="refund-btn"
            onClick={() => onRefund(session.sessionId, reason)}
            disabled={loading}
          >
            {loading ? 'Processing…' : `Refund ${fmt(session.cardAmount)} to customer`}
          </button>
        </div>
      )}

      {/* Sync refund status */}
      {session.refundId && (
        <div className="detail-section">
          <div className="detail-section-title">Refund Status</div>
          <button className="sync-btn" onClick={syncRefund} disabled={syncingRefund}>
            {syncingRefund ? 'Syncing…' : 'Sync from Razorpay'}
          </button>
          {refundStatus && (
            <pre className="refund-status-pre">
              {JSON.stringify(refundStatus, null, 2)}
            </pre>
          )}
        </div>
      )}

      {/* Danger zone */}
      <div className="detail-section">
        <button
          className="delete-btn"
          onClick={() => { if (window.confirm('Delete this session record?')) onDelete(session.sessionId); }}
        >
          Delete session record
        </button>
        <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>
          Dev only — disabled in production
        </div>
      </div>
    </div>
  );
}

// ─── Main Admin Dashboard ─────────────────────────────────────────────────────

export default function AdminDashboard({ onBack }) {
  const [data, setData]               = useState(null);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState('');
  const [selected, setSelected]       = useState(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [sweeping, setSweeping]       = useState(false);
  const [filter, setFilter]           = useState('ALL');
  const [search, setSearch]           = useState('');

  const load = useCallback(async () => {
    try {
      const res = await adminApi.getSessions();
      setData(res);
      // Refresh selected session data
      if (selected) {
        const fresh = res.sessions.find(s => s.sessionId === selected.sessionId);
        if (fresh) setSelected(fresh);
      }
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  }, [selected?.sessionId]);

  useEffect(() => {
    load();
    const iv = setInterval(load, 5000);
    return () => clearInterval(iv);
  }, []);

  async function handleRefund(sessionId, reason) {
    setActionLoading(true);
    try {
      await adminApi.refundSession(sessionId, reason);
      await load();
    } catch (e) {
      alert(`Refund failed: ${e.message}`);
    }
    setActionLoading(false);
  }

  async function handleDelete(sessionId) {
    try {
      await adminApi.deleteSession(sessionId);
      setSelected(null);
      await load();
    } catch (e) {
      alert(`Delete failed: ${e.message}`);
    }
  }

  async function handleSweep() {
    setSweeping(true);
    try {
      await adminApi.triggerSweep();
      await load();
    } catch (e) {
      alert(`Sweep failed: ${e.message}`);
    }
    setSweeping(false);
  }

  const FILTERS = ['ALL', 'COMPLETED', 'REFUND_FLAGGED', 'CARD_PENDING', 'UPI_PENDING', 'CANCELLED'];

  const filtered = (data?.sessions || []).filter(s => {
    const matchState = filter === 'ALL' || s.state === filter;
    const matchSearch = !search || s.sessionId.includes(search) ||
      (s.cardPaymentId || '').includes(search) ||
      (s.upiPaymentId || '').includes(search);
    return matchState && matchSearch;
  });

  return (
    <div className="admin-dash">
      {/* Header */}
      <div className="admin-header">
        <div className="admin-title-row">
          <button className="back-btn" onClick={onBack}>
            ← Checkout
          </button>
          <div>
            <div className="admin-eyebrow">Operations Console</div>
            <h2 className="admin-title">Session Dashboard</h2>
          </div>
        </div>
        <div className="admin-live">
          <span className="live-dot" />
          Live — refreshes every 5s
        </div>
      </div>

      {loading && !data && (
        <div className="admin-loading">Loading sessions…</div>
      )}
      {error && (
        <div className="admin-error">
          ⚠ {error} — is the backend running on port 4000?
        </div>
      )}

      {data && (
        <>
          <StatsStrip stats={data.stats} onSweep={handleSweep} sweeping={sweeping} />

          <div className="admin-body">
            {/* Session table */}
            <div className={`session-table-wrap ${selected ? 'narrow' : ''}`}>
              {/* Filters */}
              <div className="table-toolbar">
                <div className="filter-tabs">
                  {FILTERS.map(f => (
                    <button
                      key={f}
                      className={`filter-tab ${filter === f ? 'active' : ''}`}
                      onClick={() => setFilter(f)}
                    >
                      {f === 'ALL' ? 'All' : STATE_META[f]?.label || f}
                      {f !== 'ALL' && (
                        <span className="filter-count">
                          {data.sessions.filter(s => s.state === f).length}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
                <input
                  className="search-input"
                  placeholder="Search by ID…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
              </div>

              <div className="table-scroll">
                <table className="session-table">
                  <thead>
                    <tr>
                      <th>Session ID</th>
                      <th>State</th>
                      <th>Total</th>
                      <th>Card</th>
                      <th>Netbanking</th>
                      <th>Created</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.length === 0 ? (
                      <tr>
                        <td colSpan={7} style={{ textAlign: 'center', padding: '32px', color: 'var(--muted)', fontSize: 13 }}>
                          No sessions match this filter
                        </td>
                      </tr>
                    ) : (
                      filtered.map(s => (
                        <SessionRow
                          key={s.sessionId}
                          session={s}
                          onSelect={setSelected}
                          selected={selected?.sessionId === s.sessionId}
                        />
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Detail panel */}
            {selected && (
              <SessionDetail
                session={selected}
                onRefund={handleRefund}
                onDelete={handleDelete}
                onClose={() => setSelected(null)}
                loading={actionLoading}
              />
            )}
          </div>
        </>
      )}

      <style>{`
        .admin-dash {
          min-height: 100vh;
          padding: 0 24px 60px;
          max-width: 1200px;
          margin: 0 auto;
        }

        /* Header */
        .admin-header {
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          padding: 24px 0 28px;
          border-bottom: 1px solid var(--ink-80);
          margin-bottom: 24px;
          flex-wrap: wrap;
          gap: 12px;
        }
        .admin-title-row {
          display: flex;
          align-items: center;
          gap: 16px;
        }
        .back-btn {
          background: var(--ink-80);
          border: 1px solid var(--ink-60);
          color: var(--smoke);
          font-family: var(--font-body);
          font-size: 13px;
          padding: 8px 14px;
          border-radius: var(--radius-sm);
          cursor: pointer;
          transition: all var(--transition);
          white-space: nowrap;
        }
        .back-btn:hover { background: var(--ink-60); color: var(--paper); }
        .admin-eyebrow {
          font-family: var(--font-mono);
          font-size: 10px;
          color: var(--gold);
          letter-spacing: 0.1em;
          text-transform: uppercase;
          margin-bottom: 3px;
        }
        .admin-title {
          font-family: var(--font-display);
          font-size: 22px;
          color: var(--paper);
          font-weight: 400;
        }
        .admin-live {
          display: flex;
          align-items: center;
          gap: 6px;
          font-family: var(--font-mono);
          font-size: 11px;
          color: var(--emerald);
        }
        .live-dot {
          width: 6px; height: 6px;
          border-radius: 50%;
          background: var(--emerald);
          animation: pulse 2s ease-in-out infinite;
        }
        @keyframes pulse { 0%,100% { opacity:1 } 50% { opacity:0.4 } }

        .admin-loading, .admin-error {
          text-align: center;
          padding: 48px;
          font-size: 14px;
          color: var(--muted);
        }
        .admin-error { color: var(--crimson); }

        /* Stats */
        .stats-strip {
          display: flex;
          gap: 12px;
          margin-bottom: 20px;
          flex-wrap: wrap;
          align-items: center;
        }
        .stat-card {
          flex: 1;
          min-width: 100px;
          background: var(--ink-90);
          border: 1px solid var(--ink-60);
          border-radius: var(--radius-md);
          padding: 14px 16px;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .stat-card.success { border-color: rgba(46,204,143,0.2); }
        .stat-card.warn    { border-color: rgba(201,168,76,0.2); }
        .stat-card.danger  { border-color: rgba(224,80,80,0.2); }
        .stat-card.revenue { border-color: rgba(201,168,76,0.3); background: rgba(201,168,76,0.04); }
        .stat-val {
          font-family: var(--font-display);
          font-size: 24px;
          color: var(--paper);
        }
        .revenue-val { font-size: 18px; color: var(--gold-lt); }
        .stat-lbl {
          font-family: var(--font-mono);
          font-size: 10px;
          color: var(--muted);
          text-transform: uppercase;
          letter-spacing: 0.06em;
        }
        .sweep-btn {
          padding: 10px 18px;
          background: var(--ink-80);
          border: 1px solid var(--ink-60);
          color: var(--smoke);
          font-family: var(--font-mono);
          font-size: 12px;
          border-radius: var(--radius-sm);
          cursor: pointer;
          transition: all var(--transition);
          white-space: nowrap;
        }
        .sweep-btn:hover { background: var(--ink-60); color: var(--paper); }
        .sweep-btn:disabled { opacity: 0.5; cursor: default; }

        /* Body layout */
        .admin-body {
          display: flex;
          gap: 20px;
          align-items: flex-start;
        }
        .session-table-wrap { flex: 1; min-width: 0; }
        .session-table-wrap.narrow { max-width: 55%; }

        /* Toolbar */
        .table-toolbar {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 12px;
          flex-wrap: wrap;
        }
        .filter-tabs {
          display: flex;
          gap: 4px;
          flex-wrap: wrap;
        }
        .filter-tab {
          display: flex;
          align-items: center;
          gap: 5px;
          padding: 5px 10px;
          background: transparent;
          border: 1px solid var(--ink-60);
          border-radius: 20px;
          color: var(--muted);
          font-family: var(--font-mono);
          font-size: 11px;
          cursor: pointer;
          transition: all var(--transition);
        }
        .filter-tab:hover { border-color: var(--smoke); color: var(--smoke); }
        .filter-tab.active { background: var(--ink-80); border-color: var(--gold); color: var(--gold); }
        .filter-count {
          background: var(--ink-60);
          color: var(--muted);
          padding: 1px 5px;
          border-radius: 10px;
          font-size: 10px;
        }
        .search-input {
          background: var(--ink-80);
          border: 1px solid var(--ink-60);
          border-radius: var(--radius-sm);
          color: var(--smoke);
          font-family: var(--font-mono);
          font-size: 12px;
          padding: 6px 12px;
          outline: none;
          width: 180px;
          transition: border-color var(--transition);
        }
        .search-input:focus { border-color: var(--gold); }

        /* Table */
        .table-scroll { overflow-x: auto; }
        .session-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 13px;
        }
        .session-table th {
          text-align: left;
          padding: 10px 12px;
          font-family: var(--font-mono);
          font-size: 10px;
          color: var(--muted);
          text-transform: uppercase;
          letter-spacing: 0.06em;
          border-bottom: 1px solid var(--ink-60);
          font-weight: 400;
          white-space: nowrap;
        }
        .session-row {
          cursor: pointer;
          transition: background var(--transition);
          border-bottom: 1px solid var(--ink-80);
        }
        .session-row:hover { background: var(--ink-90); }
        .session-row.selected { background: rgba(201,168,76,0.06); border-color: rgba(201,168,76,0.15); }
        .session-row td { padding: 11px 12px; vertical-align: middle; }
        .needs-refund-badge {
          font-family: var(--font-mono);
          font-size: 10px;
          background: rgba(224,136,80,0.12);
          color: #E08850;
          border: 1px solid rgba(224,136,80,0.2);
          padding: 2px 7px;
          border-radius: 10px;
        }
        .refund-done-badge {
          font-family: var(--font-mono);
          font-size: 10px;
          background: rgba(46,204,143,0.08);
          color: var(--emerald);
          border: 1px solid rgba(46,204,143,0.2);
          padding: 2px 7px;
          border-radius: 10px;
        }

        /* Detail panel */
        .detail-panel {
          width: 380px;
          flex-shrink: 0;
          background: var(--ink-90);
          border: 1px solid var(--ink-60);
          border-radius: var(--radius-lg);
          overflow: hidden;
          position: sticky;
          top: 24px;
          max-height: 90vh;
          overflow-y: auto;
        }
        .detail-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          padding: 20px;
          border-bottom: 1px solid var(--ink-80);
          gap: 12px;
        }
        .detail-id {
          font-size: 11px;
          color: var(--muted);
          word-break: break-all;
          margin-bottom: 6px;
        }
        .close-btn {
          background: transparent;
          border: none;
          color: var(--muted);
          cursor: pointer;
          font-size: 14px;
          padding: 4px;
          flex-shrink: 0;
          transition: color var(--transition);
        }
        .close-btn:hover { color: var(--paper); }

        .detail-amounts {
          padding: 16px 20px;
          border-bottom: 1px solid var(--ink-80);
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .amount-row { display: flex; justify-content: space-between; align-items: center; }
        .amount-lbl { font-size: 12px; color: var(--muted); }
        .amount-val { font-family: var(--font-mono); font-size: 16px; color: var(--paper); font-weight: 500; }

        .detail-section {
          padding: 16px 20px;
          border-bottom: 1px solid var(--ink-80);
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .detail-section-title {
          font-family: var(--font-mono);
          font-size: 10px;
          color: var(--muted);
          text-transform: uppercase;
          letter-spacing: 0.08em;
        }

        .id-grid {
          display: grid;
          grid-template-columns: auto 1fr;
          gap: 4px 12px;
          align-items: center;
        }
        .id-lbl { font-size: 11px; color: var(--muted); }
        .id-val { font-family: var(--font-mono); font-size: 11px; color: var(--smoke); word-break: break-all; }

        .log-list {
          display: flex;
          flex-direction: column;
          gap: 6px;
          max-height: 200px;
          overflow-y: auto;
        }
        .log-entry {
          display: flex;
          gap: 8px;
          align-items: flex-start;
        }
        .log-dot {
          width: 5px; height: 5px;
          border-radius: 50%;
          background: var(--ink-60);
          flex-shrink: 0;
          margin-top: 5px;
        }
        .log-text { font-size: 11px; color: var(--muted); line-height: 1.5; font-family: var(--font-mono); }

        /* Refund section */
        .refund-action { background: rgba(224,136,80,0.04); border-color: rgba(224,136,80,0.15) !important; }
        .reason-input {
          background: var(--ink-80);
          border: 1px solid var(--ink-60);
          border-radius: var(--radius-sm);
          color: var(--smoke);
          font-family: var(--font-body);
          font-size: 12px;
          padding: 8px 10px;
          width: 100%;
          outline: none;
          transition: border-color var(--transition);
        }
        .reason-input:focus { border-color: #E08850; }
        .refund-btn {
          padding: 10px 16px;
          background: rgba(224,136,80,0.12);
          border: 1px solid rgba(224,136,80,0.3);
          border-radius: var(--radius-sm);
          color: #E08850;
          font-family: var(--font-body);
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          transition: all var(--transition);
          width: 100%;
          text-align: center;
        }
        .refund-btn:hover { background: rgba(224,136,80,0.2); }
        .refund-btn:disabled { opacity: 0.5; cursor: default; }

        .sync-btn {
          padding: 8px 14px;
          background: var(--ink-80);
          border: 1px solid var(--ink-60);
          color: var(--smoke);
          font-family: var(--font-mono);
          font-size: 11px;
          border-radius: var(--radius-sm);
          cursor: pointer;
          transition: all var(--transition);
        }
        .sync-btn:hover { border-color: var(--smoke); }
        .refund-status-pre {
          font-family: var(--font-mono);
          font-size: 10px;
          color: var(--smoke);
          background: var(--ink);
          border-radius: var(--radius-sm);
          padding: 10px;
          overflow-x: auto;
          white-space: pre-wrap;
          word-break: break-all;
        }

        .delete-btn {
          padding: 8px 14px;
          background: transparent;
          border: 1px solid rgba(224,80,80,0.2);
          color: var(--crimson);
          font-family: var(--font-mono);
          font-size: 11px;
          border-radius: var(--radius-sm);
          cursor: pointer;
          transition: all var(--transition);
          width: 100%;
        }
        .delete-btn:hover { background: rgba(224,80,80,0.08); }
      `}</style>
    </div>
  );
}
