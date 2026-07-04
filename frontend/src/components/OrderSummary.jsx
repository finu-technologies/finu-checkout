// components/OrderSummary.jsx

import React from 'react';

export default function OrderSummary({ total }) {
  // ─── Read merchant details from URL params ────────────────────────────────
  const params       = new URLSearchParams(window.location.search);
  const merchantName = params.get('merchant_name')
                         ? decodeURIComponent(params.get('merchant_name'))
                         : 'Order Summary';
  const productName  = params.get('product')
                         ? decodeURIComponent(params.get('product'))
                         : 'Order Payment';
  const orderId      = params.get('order_id') || 'N/A';
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="order-summary">
      <div className="summary-header">
        <span className="summary-tag">Order #{orderId}</span>
        <h2 className="summary-title">{merchantName}</h2>
      </div>

      <div className="summary-items">
        <div className="summary-item">
          <div className="item-info">
            <span className="item-name">{productName}</span>
          </div>
          <span className="item-price">₹{total.toLocaleString('en-IN')}</span>
        </div>
      </div>

      <div className="summary-divider" />

      <div className="summary-total">
        <span>Total Payable</span>
        <span className="total-amount">₹{total.toLocaleString('en-IN')}</span>
      </div>

      <div className="summary-badge">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
        </svg>
        <span>Secured by FinU Technologies</span>
      </div>

      <style>{`
        .order-summary {
          background: var(--ink-90);
          border: 1px solid var(--ink-60);
          border-radius: var(--radius-lg);
          padding: 28px;
          position: sticky;
          top: 24px;
        }
        .summary-header { margin-bottom: 20px; }
        .summary-tag {
          font-family: var(--font-mono);
          font-size: 11px;
          color: var(--gold);
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }
        .summary-title {
          font-family: var(--font-display);
          font-size: 22px;
          color: var(--paper);
          margin-top: 4px;
          font-weight: 400;
        }
        .summary-items { display: flex; flex-direction: column; gap: 12px; }
        .summary-item {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 12px;
        }
        .item-info { display: flex; flex-direction: column; gap: 2px; flex: 1; }
        .item-name { font-size: 13px; color: var(--smoke); line-height: 1.4; }
        .item-price {
          font-family: var(--font-mono);
          font-size: 13px;
          color: var(--smoke);
          white-space: nowrap;
        }
        .summary-divider {
          height: 1px;
          background: var(--ink-60);
          margin: 20px 0;
        }
        .summary-total {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          font-size: 15px;
          color: var(--smoke);
        }
        .total-amount {
          font-family: var(--font-display);
          font-size: 26px;
          color: var(--gold-lt);
        }
        .summary-badge {
          display: flex;
          align-items: center;
          gap: 6px;
          margin-top: 20px;
          padding: 10px 14px;
          background: rgba(201,168,76,0.06);
          border: 1px solid rgba(201,168,76,0.15);
          border-radius: var(--radius-sm);
          font-size: 11px;
          color: var(--gold-dk);
        }
      `}</style>
    </div>
  );
}
