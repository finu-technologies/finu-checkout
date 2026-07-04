// App.jsx — FinU Split Payment Checkout

import React, { useState, useCallback } from 'react';
import OrderSummary from './components/OrderSummary.jsx';
import SplitSlider from './components/SplitSlider.jsx';
import PaymentStatus from './components/PaymentStatus.jsx';
import AdminDashboard from './components/AdminDashboard.jsx';
import { api } from './utils/api.js';
import { useRazorpay } from './hooks/useRazorpay.js';

// ─── CHANGE 1: Dynamic amount from URL params ─────────────────────────────────
// Merchant sends customer to:
// checkout.finupay.in?amount=25000&order_id=ORD123&merchant_id=hotspot&return_url=https://merchant.com/thankyou
const params     = new URLSearchParams(window.location.search);
const ORDER_TOTAL  = params.get('amount')     ? Number(params.get('amount'))  : 150000;
const MERCHANT_ID  = params.get('merchant_id') || 'demo';
const ORDER_REF    = params.get('order_id')    || 'DEMO001';
const RETURN_URL   = params.get('return_url')  || null;
// ─────────────────────────────────────────────────────────────────────────────

const PHASE = {
  CONFIGURE:  'CONFIGURE',   // User configures split amounts
  PROCESSING: 'PROCESSING',  // Payments in progress
  DONE:       'DONE',        // Terminal state
};

export default function App() {
  const [phase, setPhase]           = useState(PHASE.CONFIGURE);
  const [cardAmount, setCardAmount] = useState(Math.round(ORDER_TOTAL * 0.67)); // default ~67% on card
  const [sessionId, setSessionId]   = useState(null);
  const [payState, setPayState]     = useState('CREATED');
  const [error, setError]           = useState('');
  const [loading, setLoading]       = useState(false);
  const [showAdmin, setShowAdmin]   = useState(false);

  const { openCheckout } = useRazorpay();

  const upiAmount = ORDER_TOTAL - cardAmount;

  // ─── ORCHESTRATION ENTRY POINT ─────────────────────────────
  const handleProceed = useCallback(async () => {
    if (cardAmount <= 0 || upiAmount <= 0) {
      alert('Both card and UPI amounts must be greater than ₹0.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      // STEP 1: Create session
      const session = await api.createSession({
        orderTotal:    ORDER_TOTAL,
        cardAmount,
        upiAmount,
        customerEmail: 'demo@finu.in',
        customerPhone: '9000000000',
      });

      setSessionId(session.sessionId);
      setPhase(PHASE.PROCESSING);
      setPayState('CARD_PENDING');

      // STEP 2: Open Razorpay for CARD
      let cardResponse;
      try {
        cardResponse = await openCheckout({
          key:         session.razorpayKeyId,
          order_id:    session.cardOrderId,
          amount:      Math.round(cardAmount * 100),
          currency:    'INR',
          name:        'FinU Technologies',
          description: `Step 1 of 2 — Card payment ₹${cardAmount.toLocaleString('en-IN')}`,
          image:       '',
          prefill:     { email: 'demo@finu.in', contact: '9000000000' },
          theme:       { color: '#C9A84C' },
          notes:       { leg: 'CARD', sessionId: session.sessionId, merchant_id: MERCHANT_ID, order_ref: ORDER_REF },
        });
      } catch (cardErr) {
        // Card cancelled or failed — no money moved, safe to cancel
        await api.cancelSession(session.sessionId);
        setPayState('CARD_FAILED');
        setError(cardErr.message || 'Card payment was not completed.');
        setPhase(PHASE.DONE);
        setLoading(false);
        return;
      }

      // STEP 3: Verify card with backend
      let upiSession;
      try {
        upiSession = await api.verifyCard({
          sessionId:            session.sessionId,
          razorpay_order_id:    cardResponse.razorpay_order_id,
          razorpay_payment_id:  cardResponse.razorpay_payment_id,
          razorpay_signature:   cardResponse.razorpay_signature,
        });
        setPayState('UPI_PENDING');
      } catch (verifyErr) {
        setPayState('CARD_FAILED');
        setError(verifyErr.message || 'Card verification failed.');
        setPhase(PHASE.DONE);
        setLoading(false);
        return;
      }

      // STEP 4: Open Razorpay for UPI
      // ─── CHANGE 2: UPI method restriction now works in live mode ──────────
      // In Live Mode this caused "No appropriate payment method found" because
      // UPI was not enabled on test accounts. Now that UPI is enabled on the
      // live FinU Razorpay account, we can safely restrict Leg 2 to UPI only.
      // This prevents customers from accidentally paying Leg 2 by card.
      // ─────────────────────────────────────────────────────────────────────
      let upiResponse;
      try {
        upiResponse = await openCheckout({
          key:         upiSession.razorpayKeyId,
          order_id:    upiSession.upiOrderId,
          amount:      Math.round(upiAmount * 100),
          currency:    'INR',
          name:        'FinU Technologies — Step 2 of 2',
          description: `UPI payment ₹${upiAmount.toLocaleString('en-IN')} — almost done!`,
          prefill:     { email: 'demo@finu.in', contact: '9000000000' },
          theme:       { color: '#4A90D9' },
          notes:       { leg: 'UPI', sessionId: session.sessionId, merchant_id: MERCHANT_ID, order_ref: ORDER_REF },
          method: {
            upi:        true,
            card:       false,
            netbanking: false,
            wallet:     false,
            emi:        false,
          },
        }, true); // lockModal=true — prevents accidental close after card charged
      } catch (upiErr) {
        // UPI failed AFTER card succeeded — flag for refund
        await api.cancelSession(session.sessionId);
        setPayState('REFUND_FLAGGED');
        setError(`UPI payment was not completed. Your card payment of ₹${cardAmount.toLocaleString('en-IN')} has been flagged for refund. We will process it within 24 hours.`);
        setPhase(PHASE.DONE);
        setLoading(false);
        return;
      }

      // STEP 5: Verify UPI with backend
      try {
        await api.verifyUpi({
          sessionId:           session.sessionId,
          razorpay_order_id:   upiResponse.razorpay_order_id,
          razorpay_payment_id: upiResponse.razorpay_payment_id,
          razorpay_signature:  upiResponse.razorpay_signature,
        });
        setPayState('COMPLETED');
        setPhase(PHASE.DONE);

        // ─── CHANGE 3: Redirect back to merchant after success ───────────────
        if (RETURN_URL) {
          setTimeout(() => {
            window.location.href = `${RETURN_URL}?status=success&order_id=${ORDER_REF}&merchant_id=${MERCHANT_ID}`;
          }, 2000);
        }
        // ─────────────────────────────────────────────────────────────────────

      } catch (upiVerifyErr) {
        setPayState('REFUND_FLAGGED');
        setError('UPI verification failed. Your card payment has been flagged for refund within 24 hours.');
        setPhase(PHASE.DONE);
      }
    } catch (err) {
      setError(err.message || 'An unexpected error occurred.');
      setPayState('CANCELLED');
      setPhase(PHASE.DONE);
    }

    setLoading(false);
  }, [cardAmount, upiAmount, openCheckout]);

  const handleReset = () => {
    setPhase(PHASE.CONFIGURE);
    setCardAmount(Math.round(ORDER_TOTAL * 0.67));
    setSessionId(null);
    setPayState('CREATED');
    setError('');
    setLoading(false);
  };

  return (
    <div className="app">
      {showAdmin && <AdminDashboard onBack={() => setShowAdmin(false)} />}
      {!showAdmin && (<>
      {/* Header */}
      <header className="header">
        <div className="logo">
          <span className="logo-mark">ƒ</span>
          <span className="logo-text">FinU</span>
        </div>
        {/* ─── CHANGE 4: Badge updated to Live Mode ─────────────────────── */}
        <div className="header-badge">
          <span className="badge-dot" />
          Live Mode
        </div>
        {/* ──────────────────────────────────────────────────────────────── */}
        <button className="admin-nav-btn" onClick={() => setShowAdmin(true)}>
          Sessions ↗
        </button>
      </header>

      {/* Hero */}
      <div className="hero">
        <div className="hero-label">Split Tender Payment</div>
        <h1 className="hero-title">
          Pay your way,<br />
          <em>split across instruments</em>
        </h1>
      </div>

      {/* Main grid */}
      <main className="main-grid">
        {/* Left: Order summary */}
        <aside className="col-summary">
          <OrderSummary total={ORDER_TOTAL} />
        </aside>

        {/* Right: Checkout form or status */}
        <div className="col-checkout">
          {phase === PHASE.CONFIGURE && (
            <div className="checkout-card">
              <div className="checkout-header">
                <h2 className="checkout-title">Configure Split</h2>
                <p className="checkout-sub">
                  Total <strong>₹{ORDER_TOTAL.toLocaleString('en-IN')}</strong> — drag the slider or type your card amount.
                </p>
              </div>

              <div className="checkout-body">
                <SplitSlider
                  total={ORDER_TOTAL}
                  cardAmount={cardAmount}
                  onChange={setCardAmount}
                />

                {/* Summary row */}
                <div className="split-summary">
                  <div className="summary-row">
                    <span className="row-label">Card</span>
                    <span className="row-amount card-amount">₹{cardAmount.toLocaleString('en-IN')}</span>
                  </div>
                  <div className="summary-row">
                    <span className="row-label">UPI</span>
                    <span className="row-amount upi-amount">₹{upiAmount.toLocaleString('en-IN')}</span>
                  </div>
                  <div className="summary-divider" />
                  <div className="summary-row total-row">
                    <span className="row-label">Total</span>
                    <span className="row-amount total-amount-row">₹{ORDER_TOTAL.toLocaleString('en-IN')}</span>
                  </div>
                </div>

                {/* Flow info */}
                <div className="flow-info">
                  <div className="flow-step">
                    <div className="flow-num">1</div>
                    <span>Card charges first (₹{cardAmount.toLocaleString('en-IN')})</span>
                  </div>
                  <div className="flow-arrow">→</div>
                  <div className="flow-step">
                    <div className="flow-num">2</div>
                    <span>UPI only on card success (₹{upiAmount.toLocaleString('en-IN')})</span>
                  </div>
                  <div className="flow-arrow">→</div>
                  <div className="flow-step">
                    <div className="flow-num">3</div>
                    <span>Order confirmed on both</span>
                  </div>
                </div>

                <button
                  className="proceed-btn"
                  onClick={handleProceed}
                  disabled={loading || cardAmount <= 0 || upiAmount <= 0}
                >
                  {loading ? (
                    <>
                      <div className="btn-spinner" />
                      Processing…
                    </>
                  ) : (
                    <>
                      Proceed to Pay — ₹{ORDER_TOTAL.toLocaleString('en-IN')}
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="5" y1="12" x2="19" y2="12"/>
                        <polyline points="12 5 19 12 12 19"/>
                      </svg>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {(phase === PHASE.PROCESSING || phase === PHASE.DONE) && (
            <PaymentStatus
              state={payState}
              sessionId={sessionId}
              error={error}
              onReset={handleReset}
            />
          )}
        </div>
      </main>

      <style>{`
        .app {
          min-height: 100vh;
          max-width: 1100px;
          margin: 0 auto;
          padding: 0 24px 60px;
        }

        /* Header */
        .header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 24px 0;
          border-bottom: 1px solid var(--ink-80);
          margin-bottom: 40px;
        }
        .logo {
          display: flex;
          align-items: baseline;
          gap: 6px;
        }
        .logo-mark {
          font-family: var(--font-display);
          font-size: 28px;
          color: var(--gold);
          line-height: 1;
        }
        .logo-text {
          font-family: var(--font-display);
          font-size: 20px;
          color: var(--paper);
          letter-spacing: -0.02em;
        }
        .header-badge {
          display: flex;
          align-items: center;
          gap: 6px;
          font-family: var(--font-mono);
          font-size: 11px;
          color: var(--emerald);
          background: rgba(46,204,143,0.08);
          border: 1px solid rgba(46,204,143,0.2);
          padding: 5px 10px;
          border-radius: 20px;
          letter-spacing: 0.04em;
        }
        .badge-dot {
          width: 6px; height: 6px;
          border-radius: 50%;
          background: var(--emerald);
          animation: pulse 2s ease-in-out infinite;
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }

        /* Hero */
        .hero { margin-bottom: 40px; }
        .hero-label {
          font-family: var(--font-mono);
          font-size: 11px;
          color: var(--gold);
          letter-spacing: 0.12em;
          text-transform: uppercase;
          margin-bottom: 10px;
        }
        .hero-title {
          font-family: var(--font-display);
          font-size: clamp(28px, 4vw, 40px);
          color: var(--paper);
          font-weight: 400;
          line-height: 1.2;
        }
        .hero-title em {
          color: var(--gold);
          font-style: italic;
        }

        /* Grid */
        .main-grid {
          display: grid;
          grid-template-columns: 380px 1fr;
          gap: 28px;
          align-items: start;
        }
        @media (max-width: 820px) {
          .main-grid { grid-template-columns: 1fr; }
          .col-summary { order: 2; }
          .col-checkout { order: 1; }
        }

        /* Checkout card */
        .checkout-card {
          background: var(--ink-90);
          border: 1px solid var(--ink-60);
          border-radius: var(--radius-lg);
          overflow: hidden;
        }
        .checkout-header {
          padding: 28px 28px 20px;
          border-bottom: 1px solid var(--ink-80);
        }
        .checkout-title {
          font-family: var(--font-display);
          font-size: 22px;
          color: var(--paper);
          font-weight: 400;
          margin-bottom: 6px;
        }
        .checkout-sub {
          font-size: 13px;
          color: var(--muted);
        }
        .checkout-sub strong { color: var(--smoke); }

        .checkout-body { padding: 24px 28px 28px; display: flex; flex-direction: column; gap: 24px; }

        /* Split summary */
        .split-summary {
          background: var(--ink-80);
          border: 1px solid var(--ink-60);
          border-radius: var(--radius-md);
          padding: 16px 20px;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .summary-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 13px;
        }
        .row-label { color: var(--muted); }
        .row-amount {
          font-family: var(--font-mono);
          font-size: 14px;
          font-weight: 500;
        }
        .card-amount { color: var(--gold-lt); }
        .upi-amount  { color: var(--sapphire); }
        .summary-divider { height: 1px; background: var(--ink-60); }
        .total-row .row-label { color: var(--smoke); font-weight: 500; }
        .total-amount-row { color: var(--paper); font-size: 16px; }

        /* Flow info */
        .flow-info {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }
        .flow-step {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 12px;
          color: var(--muted);
        }
        .flow-num {
          width: 20px; height: 20px;
          border-radius: 50%;
          background: var(--ink-80);
          border: 1px solid var(--ink-60);
          display: flex; align-items: center; justify-content: center;
          font-family: var(--font-mono);
          font-size: 10px;
          color: var(--gold);
          flex-shrink: 0;
        }
        .flow-arrow { color: var(--ink-60); font-size: 12px; }

        /* Proceed button */
        .proceed-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          width: 100%;
          padding: 16px 24px;
          background: linear-gradient(135deg, var(--gold-dk), var(--gold));
          border: none;
          border-radius: var(--radius-md);
          color: var(--ink);
          font-family: var(--font-body);
          font-size: 15px;
          font-weight: 600;
          cursor: pointer;
          transition: all var(--transition);
          position: relative;
          overflow: hidden;
        }
        .proceed-btn::before {
          content: '';
          position: absolute;
          inset: 0;
          background: rgba(255,255,255,0.1);
          opacity: 0;
          transition: opacity var(--transition);
        }
        .proceed-btn:hover::before { opacity: 1; }
        .proceed-btn:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
        .btn-spinner {
          width: 16px; height: 16px;
          border: 2px solid rgba(0,0,0,0.2);
          border-top-color: var(--ink);
          border-radius: 50%;
          animation: spin 0.7s linear infinite;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
        .admin-nav-btn {
          padding: 7px 14px;
          background: transparent;
          border: 1px solid var(--ink-60);
          border-radius: var(--radius-sm);
          color: var(--muted);
          font-family: var(--font-mono);
          font-size: 11px;
          cursor: pointer;
          transition: all var(--transition);
        }
        .admin-nav-btn:hover { border-color: var(--gold); color: var(--gold); }
      `}</style>
    </>)}
  </div>
  );
}
